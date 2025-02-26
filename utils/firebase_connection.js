const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

const fireBaseConnection = () => {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase connection initialized.");
};

module.exports = { fireBaseConnection };