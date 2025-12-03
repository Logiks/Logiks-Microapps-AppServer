#!/bin/bash

BASE_URL="http://localhost:9999"

echo "=============================="
echo "✅ 1. PUBLIC PING"
echo "=============================="
curl -s "$BASE_URL/api/public/public/ping"
echo -e "\n\n"

echo "=============================="
echo "✅ 2. LOGIN (USERNAME/PASSWORD)"
echo "=============================="

LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/public/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123",
    "deviceType": "web"
  }')

echo "$LOGIN_RESPONSE"
echo -e "\n"

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken')
REFRESH_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.refreshToken')

echo "Access Token: $ACCESS_TOKEN"
echo "Refresh Token: $REFRESH_TOKEN"
echo -e "\n"

echo "=============================="
echo "✅ 3. ACCESS PROTECTED ORDERS API (orders:read)"
echo "=============================="

curl -s "$BASE_URL/api/orders/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo -e "\n\n"

echo "=============================="
echo "✅ 4. ACCESS ADMIN API (admin only)"
echo "=============================="

curl -s "$BASE_URL/api/admin/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo -e "\n\n"

echo "=============================="
echo "✅ 5. ACCESS SWAGGER OPENAPI (docs:read)"
echo "=============================="

curl -s "$BASE_URL/api/swagger/openapi.json" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
echo -e "\n\n"

echo "=============================="
echo "✅ 6. REFRESH TOKEN"
echo "=============================="

REFRESH_RESPONSE=$(curl -s -X POST "$BASE_URL/api/public/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"$REFRESH_TOKEN\",
    \"deviceType\": \"web\"
  }")

echo "$REFRESH_RESPONSE"
echo -e "\n"

ACCESS_TOKEN_NEW=$(echo "$REFRESH_RESPONSE" | jq -r '.accessToken')
REFRESH_TOKEN_NEW=$(echo "$REFRESH_RESPONSE" | jq -r '.refreshToken')

echo "New Access Token: $ACCESS_TOKEN_NEW"
echo "New Refresh Token: $REFRESH_TOKEN_NEW"
echo -e "\n"

echo "=============================="
echo "✅ 7. LOGOUT CURRENT DEVICE"
echo "=============================="

curl -s -X POST "$BASE_URL/api/auth/logout" \
  -H "Authorization: Bearer $ACCESS_TOKEN_NEW" \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"$REFRESH_TOKEN_NEW\"
  }"
echo -e "\n\n"

echo "=============================="
echo "✅ 8. TRY USING TOKEN AFTER LOGOUT (SHOULD FAIL)"
echo "=============================="

curl -s "$BASE_URL/api/orders/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN_NEW"
echo -e "\n\n"

echo "=============================="
echo "✅ 9. LOGIN AGAIN (MOBILE DEVICE)"
echo "=============================="

LOGIN_MOBILE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/public/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123",
    "deviceType": "mobile"
  }')

echo "$LOGIN_MOBILE_RESPONSE"
echo -e "\n"

ACCESS_TOKEN_MOBILE=$(echo "$LOGIN_MOBILE_RESPONSE" | jq -r '.accessToken')
REFRESH_TOKEN_MOBILE=$(echo "$LOGIN_MOBILE_RESPONSE" | jq -r '.refreshToken')

echo "Mobile Access Token: $ACCESS_TOKEN_MOBILE"
echo "Mobile Refresh Token: $REFRESH_TOKEN_MOBILE"
echo -e "\n"

echo "=============================="
echo "✅ 10. LOGOUT FROM ALL DEVICES"
echo "=============================="

curl -s -X POST "$BASE_URL/api/auth/logout-all" \
  -H "Authorization: Bearer $ACCESS_TOKEN_MOBILE"
echo -e "\n\n"

echo "=============================="
echo "✅ 11. TRY ACCESS AFTER LOGOUT-ALL (SHOULD FAIL)"
echo "=============================="

curl -s "$BASE_URL/api/orders/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN_MOBILE"
echo -e "\n\n"

echo "=============================="
echo "✅ 12. OTP LOGIN FLOW"
echo "=============================="

# 12.1 Request OTP
curl -s -X POST "$BASE_URL/api/public/auth/request-otp" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "user2@example.com",
    "deviceType": "web"
  }'
echo -e "\n\n"

echo "⚠️  Check server logs for OTP value"
read -p "Enter OTP from logs: " OTP_CODE

# 12.2 Verify OTP
OTP_VERIFY_RESPONSE=$(curl -s -X POST "$BASE_URL/api/public/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{
    \"identifier\": \"user2@example.com\",
    \"otp\": \"$OTP_CODE\",
    \"deviceType\": \"web\"
  }")

echo "$OTP_VERIFY_RESPONSE"
echo -e "\n"

OTP_ACCESS=$(echo "$OTP_VERIFY_RESPONSE" | jq -r '.accessToken')

echo "=============================="
echo "✅ 13. TRY ORDERS WITH OTP USER (orders:read only)"
echo "=============================="

curl -s "$BASE_URL/api/orders/orders" \
  -H "Authorization: Bearer $OTP_ACCESS"
echo -e "\n\n"

echo "=============================="
echo "✅ 14. TRY ADMIN API WITH OTP USER (SHOULD FAIL)"
echo "=============================="

curl -s "$BASE_URL/api/admin/users" \
  -H "Authorization: Bearer $OTP_ACCESS"
echo -e "\n\n"

echo "=============================="
echo "✅ ALL TESTS COMPLETED"
echo "=============================="
echo "You can now check the server logs for detailed output."
echo "If you need to run this test again, please restart the server."
echo "Thank you for testing the API!"
echo -e "\n"