// Shared helpers for the users and tasks routes.

// An error with an HTTP status and a human-readable message.
class HttpError extends Error {
    constructor(status, message, data) {
        super(message);
        this.status = status;
        this.data = data === undefined ? message : data;
    }
}

// Every response is { message, data }.
function send(res, status, message, data) {
    return res.status(status).json({ message: message, data: data });
}

// A MongoDB ObjectId is exactly 24 hex characters.
function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// Parse a JSON-encoded query string parameter (where / sort / select).
function parseJsonParam(query, key) {
    var raw = query[key];
    if (raw === undefined || raw === '') return undefined;
    var value;
    try {
        value = JSON.parse(raw);
    } catch (e) {
        throw new HttpError(400, 'Invalid JSON in "' + key + '" parameter');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new HttpError(400, '"' + key + '" must be a JSON object');
    }
    return value;
}

// Parse skip / limit: must be a non-negative integer.
function parseIntParam(query, key) {
    var raw = query[key];
    if (raw === undefined || raw === '') return undefined;
    var n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        throw new HttpError(400, '"' + key + '" must be a non-negative integer');
    }
    return n;
}

// Errors MongoDB raises because of a bad query from the client
// (e.g. a bad _id inside "where", mixed include/exclude in "select").
function isClientQueryError(err) {
    return err && (err.name === 'CastError' || err.name === 'MongoServerError' || err.name === 'StrictModeError');
}

// GET on a collection with where/sort/select/skip/limit/count.
async function listCollection(Model, req, res, defaultLimit) {
    var where = parseJsonParam(req.query, 'where') || {};
    var sort = parseJsonParam(req.query, 'sort');
    var select = parseJsonParam(req.query, 'select');
    var skip = parseIntParam(req.query, 'skip');
    var limit = parseIntParam(req.query, 'limit');
    var count = req.query.count === 'true' || req.query.count === true;

    try {
        if (count) {
            var options = {};
            if (skip !== undefined) options.skip = skip;
            if (limit !== undefined && limit > 0) options.limit = limit;
            var n = await Model.countDocuments(where, options);
            return send(res, 200, 'OK', n);
        }
        var query = Model.find(where);
        if (sort) query = query.sort(sort);
        if (select) query = query.select(select);
        if (skip !== undefined) query = query.skip(skip);
        if (limit !== undefined) query = query.limit(limit);
        else if (defaultLimit) query = query.limit(defaultLimit);
        var docs = await query.exec();
        return send(res, 200, 'OK', docs);
    } catch (err) {
        if (isClientQueryError(err)) throw new HttpError(400, 'Invalid query parameters');
        throw err;
    }
}

// GET /:id with optional select. Unknown or malformed id -> 404.
async function getOne(Model, label, req, res) {
    var id = req.params.id;
    if (!isValidId(id)) throw new HttpError(404, label + ' not found');
    var select = parseJsonParam(req.query, 'select');
    var doc;
    try {
        var query = Model.findById(id);
        if (select) query = query.select(select);
        doc = await query.exec();
    } catch (err) {
        if (isClientQueryError(err)) throw new HttpError(400, 'Invalid select parameter');
        throw err;
    }
    if (!doc) throw new HttpError(404, label + ' not found');
    return send(res, 200, 'OK', doc);
}

// Wrap an async route handler so every error becomes a clean { message, data } response.
function handle(fn) {
    return async function (req, res) {
        try {
            await fn(req, res);
        } catch (err) {
            if (err instanceof HttpError) {
                return send(res, err.status, err.message, err.data);
            }
            if (err && err.code === 11000) {
                return send(res, 400, 'A user with this email already exists', 'A user with this email already exists');
            }
            console.error(err);
            return send(res, 500, 'Internal server error', 'Something went wrong on the server. Please try again later.');
        }
    };
}

module.exports = {
    HttpError: HttpError,
    send: send,
    isValidId: isValidId,
    listCollection: listCollection,
    getOne: getOne,
    handle: handle
};
