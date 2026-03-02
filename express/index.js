const apps = require("express")();
require("dotenv").config();
const passport = require("passport");
const bodyParser = require("body-parser");
const noc = require("no-console");
const cors = require("cors");
const http = require("http");
const { Server } = require('socket.io');
const router = require("./router");           // plain router
const { init } = router;                      // init function attached to router
const { registerSocketHandlers } = require("./socketHandler");

// Bootstrap schemas, models
require("./bootstrap");
noc(apps);
apps.use(bodyParser.json({ limit: '50mb' }));
apps.use(passport.initialize());
apps.use(cors());

const server = http.createServer(apps);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
});

// Inject io into router so /notify-call can emit socket events
init(io);

// Register all socket handlers
registerSocketHandlers(io);

// Database connection
require('./db');

// Passport configuration
require('./passport')(passport);

// Routes configuration
require("./../src/routes")(apps);

const app = server;
module.exports = app;