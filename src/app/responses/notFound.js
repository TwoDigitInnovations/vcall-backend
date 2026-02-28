module.exports = (res, info) => {
    return res.status(404).send({
        'status': false,
        'message': info.message
    });
};
