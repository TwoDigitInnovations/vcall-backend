'use strict';
const mongoose = require('mongoose');
const device = new mongoose.Schema({
    device_token: {
        type: String
    },
    player_id: {
        type: String
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

device.set('toJSON', {
    getters: true,
    virtuals: false,
    transform: (doc, ret, options) => {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('Device', device);
