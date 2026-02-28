"use strict";
const router = require("express").Router();
const user = require("../../app/controller/user");

const isAuthenticated = require("./../../middlewares/isAuthenticated");

const vcall = require("../../app/controller/vcall");

// auth routes
router.post("/login", user.login);
router.post("/signUp", user.signUp);
router.get("/me", isAuthenticated(["USER", "PROVIDER", "ADMIN", "CLIENT"]), user.me);
router.get("/getAllUserlist", user.getAllUserlist);


router.get(
  "/getvcallcred",
  vcall.getVcallCred
);
module.exports = router;
