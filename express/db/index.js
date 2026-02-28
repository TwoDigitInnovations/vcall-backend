'use strict';
const mongoose = require('mongoose');
// mongoose.Promise = global.Promise;

console.log(process.env.DATABASE_URL)
mongoose.connect(process.env.DATABASE_URL)

mongoose.connection.on('connected', function () {
    console.log('Mongoose connected');
});
mongoose.connection.on('disconnected', function () {
    console.log('Mongoose default connection disconnected');
});
mongoose.connection.on('error', console.error.bind(console, 'MongoDb connection error'));

process.on('SIGINT', function () {
    mongoose.connection.close(function () {
        console.log('Mongoose default connection disconnected through app termination');
        process.exit(0);
    });
});
