var WebSocket = require('ws');
var con = new WebSocket('wss://echo.websocket.org/');
con.onopen = function () {
    con.send('Wooo~~~');
};

con.onerror = function(err) {
    console.log("Websocket error: " + JSON.stringify(err));
};
con.onmessage = function (e) {
    console.log("Server:"+ e.data);
};