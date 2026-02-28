const crypto = require("crypto");
const response = require("./../responses");

const secret = process.env.VCALL_PASSWORD;

const getTurnCredentials = () => {
    const username = Math.floor(Date.now() / 1000) + 3600; // 1 hr
    const hmac = crypto.createHmac("sha1", secret);
    hmac.update(username.toString());

    return {
        username,
        credential: hmac.digest("base64"),
    };
};

module.exports = {
    getVcallCred: async (req, res) => {
        try {
            let cred = getTurnCredentials();
            return response.ok(res, cred)
        } catch (error) {
            return response.error(res, error);

        }
    }
}
