export type NotificationSeverity = "info" | "warning" | "urgent";

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  createdAt: string;
  readAt: string | null;
  relatedId: string | null;
}

export interface NewNotification {
  type: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  relatedId?: string | null;
}

export interface NotificationRepository {
  list(limit: number): Promise<Notification[]>;
  countUnread(): Promise<number>;
  create(input: NewNotification): Promise<Notification>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}
