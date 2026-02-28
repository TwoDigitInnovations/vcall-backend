module.exports = (res) => {
    return res.status(403).send({
        'status': false,
        'message': info.message
    });
};
