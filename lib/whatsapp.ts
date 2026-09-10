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
  console.log("📤 [SEND MESSAGE REQUEST]", {
    to,
    phoneNumberId,
    preview: message.slice(0, 80).replace(/\n/g, " "),
    length: message.length,
  });

  try {
    const response = await doSend(to, message, token, phoneNumberId);
    console.log("📥 [SEND MESSAGE RESPONSE]", {
      to,
      status: response.status,
      data: response.data,
    });
    return response.data;
  } catch (firstErr: unknown) {
    const axiosErr = firstErr as { response?: { status?: number; data?: unknown }; message?: string };
    const status: number | undefined = axiosErr.response?.status;
    if (status && status >= 400 && status < 500) {
      console.error("❌ [SEND MESSAGE ERROR] WhatsApp send error (4xx, no retry):", axiosErr.response?.data || axiosErr.message);
      throw firstErr;
    }
    console.warn(`⚠️ [SEND MESSAGE RETRY] WhatsApp send failed (${status ?? "network error"}), retrying in 2s…`);
    await sleep(2000);
    try {
      const response = await doSend(to, message, token, phoneNumberId);
      console.log("📥 [SEND MESSAGE RESPONSE RETRY]", {
        to,
        status: response.status,
        data: response.data,
      });
      return response.data;
    } catch (retryErr: unknown) {
      const retryAxiosErr = retryErr as { response?: { status?: number; data?: unknown }; message?: string };
      console.error("❌ [SEND MESSAGE RETRY FAILED] WhatsApp send error (after retry):", retryAxiosErr.response?.data || retryAxiosErr.message);
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
