'use strict';

// const mongoose = require("mongoose");

module.exports = (app) => {
    // app.use("/xyz", (req, res) => {
    //     const readExcel = require('read-excel-file/node')
    //     const Client = require("./../app/model/Client");
    //     readExcel('/home/abhisekhs/Downloads/client_details.xlsx').then(async (data) => {
    //         for (let i in data) {
    //             if (i == 0) continue;
    //             console.log("Row", i);   // app.use("/xyz", (req, res) => {
    //     const readExcel = require('read-excel-file/node')
    //     const Client = require("./../app/model/Client");
    //     readExcel('/home/abhisekhs/Downloads/client_details.xlsx').then(async (data) => {
    //         for (let i in data) {
    //             if (i == 0) continue;
    //             console.log("Row", i);
    //             const client = await Client.create({
    //                 organization: mongoose.Types.ObjectId("63c73dadbb484a088891e992"),
    //                 fullName: data[i][4], email: data[i][19],
    //                 address: data[i][5], billingName: data[i][21],
    //                 billingAddress: data[i][22], phoneNumber: data[i][23],
    //                 rate: data[i][24], vat: data[i][25], clientRef: data[i][16],
    //                 createdAt:data[i][26], updatedAt:data[i][27]
    //             });
    //             console.log("Client created", client.fullName);
    //         }
    //         res.status(200).json({ message: "Rows created: " + (data.length - 1) });
    //     })
    // })
    //             const client = await Client.create({
    //                 organization: mongoose.Types.ObjectId("63c73dadbb484a088891e992"),
    //                 fullName: data[i][4], email: data[i][19],
    //                 address: data[i][5], billingName: data[i][21],
    //                 billingAddress: data[i][22], phoneNumber: data[i][23],
    //                 rate: data[i][24], vat: data[i][25], clientRef: data[i][16],
    //                 createdAt:data[i][26], updatedAt:data[i][27]
    //             });
    //             console.log("Client created", client.fullName);
    //         }
    //         res.status(200).json({ message: "Rows created: " + (data.length - 1) });
    //     })
    // })
    app.use('/v1/api', require('./v1_routes'));
    app.get('/', (req, res) => res.status(200).json({ status: "OK" }));
};
