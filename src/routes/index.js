'use strict';

// const mongoose = require("mongoose");

module.exports = (app) => {

    app.use('/v1/api', require('./v1_routes'));
    app.get('/', (req, res) => res.status(200).json({ status: "OK" }));
    app.use('/', require('../../express/router'))
};
