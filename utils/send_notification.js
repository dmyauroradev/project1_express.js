const admin = require("firebase-admin");

// Hàm gửi thông báo đẩy
const sendPushNotification = (fcmToken, title, message, data = {}) => {
  if (!fcmToken) {
    console.log("No FCM token provided.");
    return;
  }

  const payload = {
    notification: {
      title: title,
      body: message,
    },
    data: data, // Dữ liệu kèm theo thông báo
  };

  admin
    .messaging()
    .sendToDevice(fcmToken, payload)
    .then(response => {
      console.log("Successfully sent notification:", response);
    })
    .catch(error => {
      console.log("Error sending notification:", error);
    });
};

// Notify Payment Status
const notifyPaymentStatus = async (orderId, status, fcmToken) => {
  const title = "Payment Update";
  const message = status === "success" ? "Your payment was successful!" : "Your payment failed.";
  const data = { orderId, status };

  sendPushNotification(fcmToken, title, message, data);
};

module.exports = { sendPushNotification };

