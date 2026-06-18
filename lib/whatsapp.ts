// lib/whatsapp.ts
import axios from "axios";

function apiUrl(phoneNumberId: string) {
  return `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
}

export async function sendWhatsAppMessage(
  to: string,
  message: string,
  token: string,
  phoneNumberId: string
) {
  try {
    const response = await axios.post(
      apiUrl(phoneNumberId),
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Message sent successfully");
    return response.data;
  } catch (error: any) {
    console.error("WhatsApp send error:", error.response?.data || error.message);
    throw error;
  }
}

export async function markAsRead(
  messageId: string,
  token: string,
  phoneNumberId: string
) {
  try {
    await axios.post(
      apiUrl(phoneNumberId),
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch {
    // Silent fail - not critical
  }
}
