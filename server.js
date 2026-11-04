// Get the packages we need
var express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose');

// Read .env file
require('dotenv').config();

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;

// Connect to a MongoDB
mongoose.connect(process.env.MONGODB_URI).catch(function (err) { console.error('MongoDB connection error:', err.message); });
mongoose.connection.on('connected', function () { console.log('MongoDB connected'); });
mongoose.connection.on('error', function (err) { console.error('MongoDB runtime error:', err.message); });

// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    next();
};
app.use(allowCrossDomain);

// Parse URL-encoded and JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Use routes as a module (see index.js)
require('./routes')(app, router);

// Unknown endpoints
app.use(function (req, res) {
    res.status(404).json({ message: 'Endpoint not found', data: 'Endpoint not found' });
});

// Errors such as a malformed JSON body
app.use(function (err, req, res, next) {
    if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
        return res.status(400).json({ message: 'Request body is not valid JSON', data: 'Request body is not valid JSON' });
    }
    console.error(err);
    res.status(500).json({ message: 'Internal server error', data: 'Something went wrong on the server.' });
});

// Start the server
app.listen(port);
console.log('Server running on port ' + port);
