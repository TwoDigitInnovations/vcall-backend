module.exports = (res, info) => {
    return res.status(400).send({
        'status': false,
        'message': info.message
    });
};
