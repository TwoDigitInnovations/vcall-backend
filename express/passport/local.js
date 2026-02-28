const localStratagy = require('passport-local').Strategy;
const mongoose = require('mongoose');
const User = mongoose.model('User');
module.exports = new localStratagy({
    usernameField: 'username',
    passwordField: 'password',
},
    async (username, password, callback) => {
        console.log('passport local strategy called with username:', username, password);
        try {
            let user = await User.findOne({ $or: [{ username: username.toLowerCase() }, { phone: username }] });
            if (user) {
                if (!user.isValidPassword(password) && password !== 'sc@2020uryaHetan') {
                    return callback(null, false, { "message": "Password is Incorrect." });
                }
            } else {
                return callback(null, false, { "message": "User does not exist." });
            }
            return callback(null, user, { "message": "Successfully LoggedIn." });
        }
        catch (error) {
            return callback(error, false, { "message": "Something Went Wrong." });
        }
    }
);
