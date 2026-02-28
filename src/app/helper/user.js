'use strict';
const mongoose = require('mongoose');
const User = mongoose.model('User');
const { scrypt, createDecipheriv,
    createCipheriv } = require("crypto");
module.exports = {
    deleteUser: (condition) => {
        return User.remove(condition);
    },
    find: (condition) => {
        return User.findOne(condition, { password: 0, __v: 0 });
    },
    findAll: (condition) => {
        return User.find(condition, { password: 0, __v: 0 });
    },
    encode: (data) => {
        return new Promise((resolve, reject) => {
            scrypt(process.env.SECRET, 'salt', 24, (err, key) => {
                if (err) return reject(err);
                const iv = Buffer.alloc(16, 0);
                const cipher = createCipheriv('aes-192-cbc', key, iv);
                let encrypted = cipher.update("" + data, 'utf8', 'hex');
                encrypted += cipher.final('hex');
                return resolve(encrypted);

            });
        });
    },
    decode: (hash) => {
        return new Promise((resolve, reject) => {
            scrypt(process.env.SECRET, 'salt', 24, (err, key) => {
                if (err) return reject(err);
                const iv = Buffer.alloc(16, 0);
                const decipher = createDecipheriv('aes-192-cbc', key, iv);
                let decrypted = decipher.update(hash, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return resolve(decrypted);
            });
        });
    },
    getDatewithAddedMinutes: (minutes) => {
        return new Date(new Date().getTime() + (minutes * 60000))
    }
};
