var mongoose = require('mongoose');
var User = require('../models/user.js');
var Task = require('../models/task.js');
var u = require('./utils.js');
var HttpError = u.HttpError;

// Validate the request body for POST / PUT. Throws 400 on bad input.
function validateUserBody(req) {
    var body = req.body || {};

    if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw new HttpError(400, 'User must have a name');
    }
    if (typeof body.email !== 'string' || body.email.trim() === '') {
        throw new HttpError(400, 'User must have an email');
    }

    var pending = body.pendingTasks;
    if (pending === undefined || pending === null || pending === '') {
        pending = [];
    } else if (typeof pending === 'string' && req.is('application/x-www-form-urlencoded')) {
        pending = [pending]; // a single form value arrives as a string
    }
    if (!Array.isArray(pending)) {
        throw new HttpError(400, 'pendingTasks must be a list of task ids');
    }
    for (var i = 0; i < pending.length; i++) {
        if (!u.isValidId(pending[i])) {
            throw new HttpError(400, 'pendingTasks contains an invalid task id');
        }
    }
    // remove duplicates
    pending = Array.from(new Set(pending));

    return { name: body.name.trim(), email: body.email.trim(), pendingTasks: pending };
}

// Check email uniqueness and that every pending task exists and is not completed.
async function checkReferences(data, userId) {
    var emailQuery = { email: data.email };
    if (userId) emailQuery._id = { $ne: userId };
    if (await User.exists(emailQuery)) {
        throw new HttpError(400, 'A user with this email already exists');
    }

    var tasks = await Task.find({ _id: { $in: data.pendingTasks } });
    if (tasks.length !== data.pendingTasks.length) {
        throw new HttpError(404, 'One or more tasks in pendingTasks do not exist');
    }
    if (tasks.some(function (t) { return t.completed; })) {
        throw new HttpError(400, 'Completed tasks cannot be in pendingTasks');
    }
}

// Make the tasks match the user's new pendingTasks.
// oldPending: the user's previous pendingTasks ([] for a new user).
async function syncTasksForUser(userId, name, oldPending, newPending) {
    var id = String(userId);

    // tasks dropped from the list are unassigned (only if still assigned to this user)
    var removed = oldPending.filter(function (t) { return newPending.indexOf(t) === -1; });
    if (removed.length) {
        await Task.updateMany(
            { _id: { $in: removed }, assignedUser: id },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
        );
    }

    if (newPending.length) {
        // tasks that move from another user are removed from that user's list
        await User.updateMany(
            { _id: { $ne: userId }, pendingTasks: { $in: newPending } },
            { $pull: { pendingTasks: { $in: newPending } } }
        );
        // assign the listed tasks to this user
        await Task.updateMany(
            { _id: { $in: newPending } },
            { $set: { assignedUser: id, assignedUserName: name } }
        );
    }

    // keep assignedUserName up to date on all of this user's tasks (completed ones too)
    await Task.updateMany({ assignedUser: id }, { $set: { assignedUserName: name } });
}

module.exports = function (router) {

    var usersRoute = router.route('/users');

    // GET /users
    usersRoute.get(u.handle(async function (req, res) {
        await u.listCollection(User, req, res, undefined); // no default limit for users
    }));

    // POST /users
    usersRoute.post(u.handle(async function (req, res) {
        var data = validateUserBody(req);
        await checkReferences(data, null);

        var userId = new mongoose.Types.ObjectId();
        var user = new User({
            _id: userId,
            name: data.name,
            email: data.email,
            pendingTasks: data.pendingTasks
        });
        await user.save();
        await syncTasksForUser(userId, data.name, [], data.pendingTasks);

        u.send(res, 201, 'User created', user);
    }));

    var userRoute = router.route('/users/:id');

    // GET /users/:id
    userRoute.get(u.handle(async function (req, res) {
        await u.getOne(User, 'User', req, res);
    }));

    // PUT /users/:id
    userRoute.put(u.handle(async function (req, res) {
        var id = req.params.id;
        if (!u.isValidId(id)) throw new HttpError(404, 'User not found');
        var user = await User.findById(id);
        if (!user) throw new HttpError(404, 'User not found');

        var data = validateUserBody(req);
        await checkReferences(data, user._id);

        var oldPending = user.pendingTasks.slice();
        user.name = data.name;
        user.email = data.email;
        user.pendingTasks = data.pendingTasks;
        await user.save(); // dateCreated is untouched

        await syncTasksForUser(user._id, data.name, oldPending, data.pendingTasks);

        u.send(res, 200, 'User updated', user);
    }));

    // DELETE /users/:id
    userRoute.delete(u.handle(async function (req, res) {
        var id = req.params.id;
        if (!u.isValidId(id)) throw new HttpError(404, 'User not found');
        var user = await User.findById(id);
        if (!user) throw new HttpError(404, 'User not found');

        // unassign all of this user's tasks (completed ones too)
        await Task.updateMany(
            { assignedUser: id },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
        );
        await User.deleteOne({ _id: id });

        u.send(res, 200, 'User deleted', user);
    }));

    return router;
};
