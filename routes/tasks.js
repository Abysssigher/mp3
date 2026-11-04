var Task = require('../models/task.js');
var User = require('../models/user.js');
var u = require('./utils.js');
var HttpError = u.HttpError;

// Validate the request body for POST / PUT. Throws 400 on bad input.
function validateTaskBody(req) {
    var body = req.body || {};

    if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw new HttpError(400, 'Task must have a name');
    }

    // deadline: required, a date string or a timestamp in milliseconds
    var d = body.deadline;
    if (d === undefined || d === null || d === '') {
        throw new HttpError(400, 'Task must have a deadline');
    }
    if (typeof d === 'string' && /^-?\d+$/.test(d.trim())) d = Number(d);
    if (typeof d !== 'string' && typeof d !== 'number') {
        throw new HttpError(400, 'Task deadline must be a valid date');
    }
    var deadline = new Date(d);
    if (isNaN(deadline.getTime())) {
        throw new HttpError(400, 'Task deadline must be a valid date');
    }

    var description = body.description;
    if (description === undefined || description === null) description = '';
    if (typeof description !== 'string') {
        throw new HttpError(400, 'Task description must be a string');
    }

    var completed = body.completed;
    if (completed === undefined || completed === null || completed === '') completed = false;
    else if (completed === 'true') completed = true;
    else if (completed === 'false') completed = false;
    if (typeof completed !== 'boolean') {
        throw new HttpError(400, 'Task completed must be true or false');
    }

    var assignedUser = body.assignedUser;
    if (assignedUser === undefined || assignedUser === null) assignedUser = '';
    if (typeof assignedUser !== 'string') {
        throw new HttpError(400, 'assignedUser must be a user id');
    }
    if (assignedUser !== '' && !u.isValidId(assignedUser)) {
        throw new HttpError(400, 'assignedUser is not a valid user id');
    }

    var assignedUserName = body.assignedUserName;
    if (assignedUserName === undefined || assignedUserName === null) assignedUserName = '';
    if (typeof assignedUserName !== 'string') {
        throw new HttpError(400, 'assignedUserName must be a string');
    }
    if (assignedUser === '' && assignedUserName !== '' && assignedUserName !== 'unassigned') {
        throw new HttpError(400, 'assignedUserName does not match assignedUser');
    }

    return {
        name: body.name.trim(),
        description: description,
        deadline: deadline,
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUserName
    };
}

// Check the assigned user exists (404) and that the name matches (400).
// Fills in assignedUserName when it was omitted.
async function checkAssignment(data) {
    if (data.assignedUser === '') {
        data.assignedUserName = 'unassigned';
        return;
    }
    var user = await User.findById(data.assignedUser);
    if (!user) throw new HttpError(404, 'Assigned user does not exist');
    if (data.assignedUserName === '') {
        data.assignedUserName = user.name;
    } else if (data.assignedUserName !== user.name) {
        throw new HttpError(400, 'assignedUserName does not match the name of assignedUser');
    }
}

// Make users' pendingTasks match this task's assignment and completion.
async function syncUsersForTask(task) {
    var id = String(task._id);
    // the only user who should list this task: its assigned user, if the task is pending
    var owner = (task.assignedUser && !task.completed) ? task.assignedUser : null;

    var filter = { pendingTasks: id };
    if (owner) filter._id = { $ne: owner };
    await User.updateMany(filter, { $pull: { pendingTasks: id } });

    if (owner) {
        await User.updateOne({ _id: owner }, { $addToSet: { pendingTasks: id } });
    }
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');

    // GET /tasks (default limit 100)
    tasksRoute.get(u.handle(async function (req, res) {
        await u.listCollection(Task, req, res, 100);
    }));

    // POST /tasks
    tasksRoute.post(u.handle(async function (req, res) {
        var data = validateTaskBody(req);
        await checkAssignment(data);

        var task = new Task(data);
        await task.save();
        await syncUsersForTask(task);

        u.send(res, 201, 'Task created', task);
    }));

    var taskRoute = router.route('/tasks/:id');

    // GET /tasks/:id
    taskRoute.get(u.handle(async function (req, res) {
        await u.getOne(Task, 'Task', req, res);
    }));

    // PUT /tasks/:id
    taskRoute.put(u.handle(async function (req, res) {
        var id = req.params.id;
        if (!u.isValidId(id)) throw new HttpError(404, 'Task not found');
        var task = await Task.findById(id);
        if (!task) throw new HttpError(404, 'Task not found');

        var data = validateTaskBody(req);
        await checkAssignment(data);

        task.name = data.name;
        task.description = data.description;
        task.deadline = data.deadline;
        task.completed = data.completed;
        task.assignedUser = data.assignedUser;
        task.assignedUserName = data.assignedUserName;
        await task.save(); // dateCreated is untouched

        await syncUsersForTask(task);

        u.send(res, 200, 'Task updated', task);
    }));

    // DELETE /tasks/:id
    taskRoute.delete(u.handle(async function (req, res) {
        var id = req.params.id;
        if (!u.isValidId(id)) throw new HttpError(404, 'Task not found');
        var task = await Task.findById(id);
        if (!task) throw new HttpError(404, 'Task not found');

        await User.updateMany({ pendingTasks: id }, { $pull: { pendingTasks: id } });
        await Task.deleteOne({ _id: id });

        res.status(204).end();
    }));

    return router;
};
