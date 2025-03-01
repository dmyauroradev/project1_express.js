# Tích hợp thanh toán ZaloPay
Đây là module xử lý thanh toán bằng ZaloPay, có thể tích hợp vào hệ thống kinh doanh.

## Luồng hoạt động:
1. Node.js nhận yêu cầu thanh toán từ frontend.
2. Gửi yêu cầu thanh toán đến ZaloPay.
3. Xác nhận thanh toán thành công từ ZaloPay.
4. Gửi dữ liệu sang Django để tạo đơn hàng.
5. Sau khi đơn hàng được tạo thành công trên Django, Node.js gọi sendPushNotification() để gửi thông báo FCM.

## Clone Repository:
git clone https://github.com/dmyauroradev/project1_express.js.git
