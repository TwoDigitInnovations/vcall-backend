module.exports = (res,info) => {
    return res.status(409).send({
        'status': false, data: info
    });
};
