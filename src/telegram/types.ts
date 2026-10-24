// The small subset of the Telegram Bot API update shape this bot reads.
export type TgUser = { id: number; first_name?: string };
export type TgChat = { id: number; type: string };
export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  reply_to_message?: { message_id: number };
};
export type TgCallbackQuery = { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: TgChat } };
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };
