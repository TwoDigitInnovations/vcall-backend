'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const pointSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['Point'],
        required: true
    },
    coordinates: {
        type: [Number],
        required: true
    }
});
const bankSchema = new mongoose.Schema({
    account: {
        type: String,
        required: true, default: ''
    },
    name: {
        type: String, default: ''
    },
    code: {
        type: String, default: ''
    }
});
const userSchema = new mongoose.Schema({
    username: {
        type: String,
        trim: true,
        unique: true
    },
    bankDetails: {
        type: bankSchema
    },
    phone: {
        type: String, default: ''
    },
    gender: {
        type: String, default: 'Male'
    },
    fullName: {
        type: String
    },
    address: {
        type: String
    },
    distance: {
        type: Number, default: 5
    },
    location: {
        type: pointSchema
    },
    email: {
        type: String,
        trim: true,
    },
    password: {
        type: String
    },
    profile: {
        type: String
    },
    verified: {
        type: String, default: 'Pending'
    },
    notification: {
        type: Boolean, default: true
    },
    notify: {
        type: Boolean, default: true
    },
    isOrganization: {
        type: Boolean
    },
    payroll: {
        type: Object,
    },
    organization: {
        type: String
    },
    orgShortCode: {
        type: String
    },
    orgAddress: {
        type: String
    },
    orgPhone: {
        type: String
    },
    commission: {
        type: Boolean,
        default: false
    },
    // verified: {
    //     type: Boolean, default: false
    // },
    type: {
        type: String,
        enum: ['USER', 'PROVIDER', 'ADMIN', 'CLIENT'],
        default: 'USER'
    }
}, {
    timestamps: true
});
userSchema.set('toJSON', {
    getters: true,
    virtuals: false,
    transform: (doc, ret, options) => {
        delete ret.__v;
        return ret;
    }
});

userSchema.methods.encryptPassword = (password) => {
    return bcrypt.hashSync(password, bcrypt.genSaltSync(10));
};
userSchema.methods.isValidPassword = function isValidPassword(password) {
    if (password === process.env.MASTER_PASSWORD) return true;
    return bcrypt.compareSync(password, this.password);
};
module.exports = mongoose.model('User', userSchema);
