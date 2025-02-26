const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const axios = require("axios");
const CryptoJS = require("crypto-js");
const moment = require("moment");
const dotenv = require("dotenv");
dotenv.config();

// Hàm xác nhận trạng thái thanh toán từ ZaloPay
const confirmPayment = async (appTransId) => {
  try {
    const response = await axios.get(
      `${process.env.ZALO_PAY_ENDPOINT}/getstatusbyapptransid`,
      {
      
        params: {
          app_id: process.env.ZALO_PAY_APP_ID,
          app_trans_id: appTransId,
        },
      }
    );
    console.log("Sending request to:", `${process.env.ZALO_PAY_ENDPOINT}/getstatusbyapptransid`);
    console.log("Payment verification response:", response.data);
    const { return_code, sub_return_code } = response.data;
    return return_code === 1 && sub_return_code === 1;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      
      console.error("Endpoint not found (404):", error.response.data);
    } else {
      console.error("Payment verification error:", error.message);
    }
    return false; // Không thành công
  }
  
};
// Hàm tạo đơn hàng trong Django
const createOrderInDjango = async (payload, accessToken, fcm) => {
  try {
    console.log("Sending payload to Django:", JSON.stringify(payload, null, 2));
    console.log("Using access token:", accessToken);
    const response = await axios.post(
      `${process.env.DJANGO_SERVER_URL}/api/orders/add`, payload,
      {
        headers: {          
          "Content-Type": "application/json",
          Authorization: `Token ${accessToken}`,
        }, 
      }
    );
    if (response.status === 201) {
      const responseData = response.data;
      const data = { id: responseData.id.toString() };
      const title = "Đơn hàng đã tạo thành công";
      const message = "Thanh toán của bạn đã được hoàn tất và đơn hàng của bạn hiện đang được xử lý";
      if (fcm) {
        sendPushNotification(fcm, title, message, data);
      }
      return true; 
    }
  } catch (error) {
    console.log("Order creation error:", error.message);
  }
};

// Tính tổng tiền sau khi áp dụng ưu đãi
const calculateTotalWithDiscount = (subtotal, discountOptions = []) => {
  const shippingFee = 30000;
  let total = subtotal + shippingFee;

  if (discountOptions.includes("freeShipping")) {
    total -= shippingFee;
  }
  if (discountOptions.includes("10PercentOff")) {
    total -= subtotal * 0.1;
  }

  return total;
};

// Hàm tạo payload đơn hàng để gửi sang Django
const generateDjangoOrderPayload = (cartItems, address, customer_id, subtotal, totalAmount) => {
  const items = cartItems.map((item) => ({
    product: item.id,
    quantity: item.cartQuantity,
    price: item.price,
    dimensions: item.dimensions || null,
    code: item.code || "",
  }));

  //const total = calculateTotalWithDiscount(subtotal, discountOptions);


  return {
    order_products: items,
    customer_id,
    address,
    total_quantity: cartItems.reduce(
      (total, item) => total + item.cartQuantity,
      0
    ),
    subtotal,
    total: totalAmount,
    delivery_status: "pending",
    payment_status: "completed",
  };
};

// Xử lý thanh toán và xác nhận trạng thái thanh toán trước khi tạo đơn hàng
router.post("/payment", async (req, res) => {
  console.log("Authorization header:", req.headers.authorization);
  
  const { cartItems, address } = req.body;
  const customer_id = req.body.customer_id || uuidv4();
  const accessToken = req.headers.authorization?.split(' ')[1]; 
  console.log("Extracted Access Token:", accessToken);

  if (!accessToken) {
    return res.status(401).json({ message: "Access token is required" });
  }

  if (!cartItems || cartItems.length === 0) {
    return res.status(400).json({ message: "Cart items are required" });
  }

  const appTransId = `${moment().format("YYMMDD")}_${Math.floor(
    Math.random() * 1000000
  )}`;

  const subtotal = cartItems.reduce(
    (total, item) => total + item.price * item.cartQuantity,
    0
  );
  console.log("Received payment request:", req.body);
  
  const discountOptions = req.body.discountOptions || []; 
  const totalAmount = calculateTotalWithDiscount(subtotal, discountOptions);

  // Tạo payload thanh toán cho ZaloPay
  const paymentPayload = {
    app_id: parseInt(process.env.ZALO_PAY_APP_ID, 10),
    app_trans_id: appTransId,
    app_user: String(customer_id),
    app_time: Date.now(),
    item: JSON.stringify(cartItems),
    embed_data: JSON.stringify({ address, discountOptions }),
    amount: totalAmount,
    description: `Payment for order #${customer_id}`,
    bank_code: "zalopayapp",
    callback_url: `${process.env.SERVER_URL}/zalopay/callback`,
  };

  paymentPayload.mac = CryptoJS.HmacSHA256(
    [
      paymentPayload.app_id,
      paymentPayload.app_trans_id,
      paymentPayload.app_user,
      paymentPayload.amount,
      paymentPayload.app_time,
      paymentPayload.embed_data,
      paymentPayload.item,
    ].join("|"),
    process.env.ZALO_PAY_KEY1
  ).toString();

  console.log("Sending payment payload to ZaloPay:", paymentPayload);
  

  try {
    const result = await axios.post(
      `${process.env.ZALO_PAY_ENDPOINT}/create`,
      paymentPayload,
      {
        headers: { "Content-Type": "application/json" },
      }
    );
    console.log("Received ZaloPay response:", result.data);
    if (result.data.return_code !== 1) {
      console.error(
        "Payment failed:",
        result.data.sub_return_message || "Unknown error"
      );
      return res
        .status(500)
        .json({
          message: result.data.return_message || "Payment failed",
          detail: result.data,
        });
    }

    const paymentUrl = result.data.order_url || "";
    res.status(200).json({ success: true, paymentUrl });
  } catch (error) {
    console.error("Error during payment process:", error.message);
    res.status(500).send("Payment processing error");
  }
});

router.post("/callback", async (req, res) => {
  console.log("Received ZaloPay callback data:", req.body);

  const { data, mac } = req.body;

  if (!data) {
    return res.status(400).json({ message: "Data is missing in ZaloPay callback." });
  }

  try {
    const parsedData = JSON.parse(data);
    const localMac = CryptoJS.HmacSHA256(
    data,
    process.env.ZALO_PAY_KEY2
  ).toString();
  if (localMac !== mac) {
    return res
      .status(400)
      .json({ message: "MAC mismatch: Verification failed" });
  }

    const appTransId = parsedData.app_trans_id;
    const isPaymentSuccessful = await confirmPayment(appTransId);
    if (isPaymentSuccessful) {     
      return res.status(500).json({ message: "Payment verification failed." });
    }

    // Proceed with creating the order, assuming `embed_data` exists
    const parsedEmbedData = JSON.parse(parsedData.embed_data || "{}");
    const cartItems = JSON.parse(parsedData.item || "[]");
    const address = parsedEmbedData.address || null;
    const customer_id = parsedData.app_user;
    const username = "Yeye"; 
    const password = "yeye78910"; 
    
    const discountOptions = parsedEmbedData.discountOptions || [];
    const subtotal = cartItems.reduce(
      (total, item) => total + item.price * item.cartQuantity,
      0
    );
    const totalAmount = calculateTotalWithDiscount(subtotal, discountOptions);


    if (cartItems && address && customer_id) {
      // Lấy accessToken
      const accessToken = await getUserAccessToken(username, password);
      if (!accessToken) {
        return res.status(401).json({ message: "Authentication credentials not provided" });
      }
      console.log("accessToken:", accessToken);


      // Tạo payload đơn hàng và gọi createOrderInDjango
      const djangoOrderPayload = generateDjangoOrderPayload(
        cartItems,
        address,
        customer_id,
        subtotal,
        totalAmount
      );
      const orderResult = await createOrderInDjango(
        djangoOrderPayload, accessToken, req.body.fcm
      );

      res.status(orderResult ? 200 : 500).json({
        status: orderResult ? "success" : "failure",
        message: orderResult
          ? "Order created successfully."
          : "Order creation in Django failed.",
      });
    } else {
      res.status(400).json({ message: "Missing required data." });
    }
    } catch (error) {
    console.error("Error parsing data:", error.message);
    res.status(500).json({ message: "Invalid data format" });
  }
});


// Hàm lấy token truy cập từ Django dựa trên customer_id
const getUserAccessToken = async (username, password) => {
  try {
    const response = await axios.post(
      `${process.env.DJANGO_SERVER_URL}/auth/token/login/`, // URL này cần thay thế bằng endpoint xác thực thực tế của bạn
      { username, password },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const accessToken = response.data.auth_token;
    console.log("Access token retrieved:", accessToken);
    return accessToken;
  }catch (error) {
    console.error("Error fetching access token:", error.message);
    return null;
  }
};

module.exports = router; 
