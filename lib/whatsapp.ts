// lib/whatsapp.ts
import axios from "axios";

function apiUrl(phoneNumberId: string) {
  return `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function doSend(to: string, message: string, token: string, phoneNumberId: string) {
  return axios.post(
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
}

export async function sendWhatsAppMessage(
  to: string,
  message: string,
  token: string,
  phoneNumberId: string
) {
  try {
    const response = await doSend(to, message, token, phoneNumberId);
    console.log("Message sent successfully");
    return response.data;
  } catch (firstErr: any) {
    const status: number | undefined = firstErr.response?.status;
    // 4xx = client error (bad token, invalid number, etc.) — retrying won't help
    if (status && status >= 400 && status < 500) {
      console.error("WhatsApp send error (4xx, no retry):", firstErr.response?.data || firstErr.message);
      throw firstErr;
    }
    console.warn(`WhatsApp send failed (${status ?? "network error"}), retrying in 2s…`);
    await sleep(2000);
    try {
      const response = await doSend(to, message, token, phoneNumberId);
      console.log("Message sent successfully (retry)");
      return response.data;
    } catch (retryErr: any) {
      console.error("WhatsApp send error (after retry):", retryErr.response?.data || retryErr.message);
      throw retryErr;
    }
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
