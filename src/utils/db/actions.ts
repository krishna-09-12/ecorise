'use server';

import { db } from './dbConfig';
import {
  Users,
  Reports,
  Rewards,
  CollectedWastes,
  Notifications,
  Transactions,
  OtpChallenges,
} from './schema';
import { eq, sql, and, desc, gt, ne } from 'drizzle-orm';
import { sendAuthEmail } from '@/utils/email';
import { APP_NAME } from '@/lib/brand';

async function assertCollectorNotReporter(reportId: number, collectorId: number) {
  const [report] = await db.select({ userId: Reports.userId }).from(Reports).where(eq(Reports.id, reportId)).execute();
  if (report?.userId === collectorId) {
    throw new Error('You cannot collect waste you reported');
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function sendOtp(
  email: string
): Promise<{ ok: true; devOtp?: string } | { ok: false; error: string }> {
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, error: 'Invalid email' };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.delete(OtpChallenges).where(eq(OtpChallenges.email, e)).execute();
  await db.insert(OtpChallenges).values({ email: e, code, expiresAt }).execute();

  const textBody = `Your ${APP_NAME} verification code is: ${code}\n\nIt expires in 10 minutes.`;

  if (await sendAuthEmail(e, textBody)) {
    return { ok: true };
  }

  // Fallback for demonstration purposes if email fails
  console.warn(`[${APP_NAME} auth] Email failed. Fallback OTP for`, e, ':', code);
  return { 
    ok: true, 
    devOtp: code 
  };
}

export async function verifyOtp(
  email: string,
  code: string
): Promise<{ ok: true; email: string; name: string } | { ok: false; error: string }> {
  const e = normalizeEmail(email);
  const trimmed = code.trim().replace(/\s/g, '');

  const rows = await db
    .select()
    .from(OtpChallenges)
    .where(and(eq(OtpChallenges.email, e), eq(OtpChallenges.code, trimmed), gt(OtpChallenges.expiresAt, new Date())))
    .execute();

  if (!rows.length) {
    return { ok: false, error: 'Invalid or expired code' };
  }

  await db.delete(OtpChallenges).where(eq(OtpChallenges.email, e)).execute();

  const displayName = e.split('@')[0] || 'User';
  let user = await getUserByEmail(e);
  if (!user) {
    user = await createUser(e, displayName);
  }
  if (!user) {
    user = await getUserByEmail(e);
  }
  if (!user) {
    return { ok: false, error: 'Could not sign in' };
  }

  return { ok: true, email: e, name: user.name };
}

export async function createUser(email: string, name: string) {
  const e = normalizeEmail(email);
  try {
    const [user] = await db.insert(Users).values({ email: e, name }).returning().execute();
    return user;
  } catch (error) {
    console.error("Error creating user:", error);
    return null;
  }
}

export async function getUserByEmail(email: string) {
  const e = normalizeEmail(email);
  try {
    const [user] = await db.select().from(Users).where(eq(Users.email, e)).execute();
    return user;
  } catch (error) {
    console.error("Error fetching user by email:", error);
    return null;
  }
}

export async function updateUserProfile(
  email: string,
  data: {
    name: string;
    phone: string;
    address: string;
    notifications: boolean;
  }
) {
  const e = normalizeEmail(email);
  try {
    const [updated] = await db
      .update(Users)
      .set({
        name: data.name.trim(),
        phone: data.phone.trim() || null,
        address: data.address.trim() || null,
        notifications: data.notifications,
      })
      .where(eq(Users.email, e))
      .returning()
      .execute();
    return updated ?? null;
  } catch (error) {
    console.error("Error updating user profile:", error);
    return null;
  }
}

export async function createReport(
  userId: number,
  location: string,
  wasteType: string,
  amount: string,
  imageUrl?: string,
  verificationResult?: unknown
) {
  try {
    await getOrCreateReward(userId);

    const [report] = await db
      .insert(Reports)
      .values({
        userId,
        location,
        wasteType,
        amount,
        imageUrl,
        verificationResult,
        status: "pending",
      })
      .returning()
      .execute();

    // Award 10 points for reporting waste
    const pointsEarned = 10;
    await updateRewardPoints(userId, pointsEarned);

    // Create a transaction for the earned points
    await createTransaction(userId, 'earned_report', pointsEarned, 'Points earned for reporting waste');

    // Create a notification for the user
    await createNotification(
      userId,
      `You've earned ${pointsEarned} points for reporting waste!`,
      'reward'
    );

    return report;
  } catch (error) {
    console.error("Error creating report:", error);
    return null;
  }
}

export async function getReportsByUserId(userId: number) {
  try {
    const reports = await db.select().from(Reports).where(eq(Reports.userId, userId)).execute();
    return reports;
  } catch (error) {
    console.error("Error fetching reports:", error);
    return [];
  }
}

export async function getOrCreateReward(userId: number) {
  try {
    let [reward] = await db.select().from(Rewards).where(eq(Rewards.userId, userId)).execute();
    if (!reward) {
      [reward] = await db.insert(Rewards).values({
        userId,
        name: 'Default Reward',
        collectionInfo: 'Default Collection Info',
        points: 0,
        level: 1,
        isAvailable: true,
      }).returning().execute();
    }
    return reward;
  } catch (error) {
    console.error("Error getting or creating reward:", error);
    return null;
  }
}

export async function updateRewardPoints(userId: number, pointsToAdd: number) {
  try {
    const [updatedReward] = await db
      .update(Rewards)
      .set({ 
        points: sql`${Rewards.points} + ${pointsToAdd}`,
        updatedAt: new Date()
      })
      .where(eq(Rewards.userId, userId))
      .returning()
      .execute();
    return updatedReward;
  } catch (error) {
    console.error("Error updating reward points:", error);
    return null;
  }
}

export async function createCollectedWaste(reportId: number, collectorId: number, notes?: string) {
  try {
    const [collectedWaste] = await db
      .insert(CollectedWastes)
      .values({
        reportId,
        collectorId,
        collectionDate: new Date(),
      })
      .returning()
      .execute();
    return collectedWaste;
  } catch (error) {
    console.error("Error creating collected waste:", error);
    return null;
  }
}

export async function getCollectedWastesByCollector(collectorId: number) {
  try {
    return await db.select().from(CollectedWastes).where(eq(CollectedWastes.collectorId, collectorId)).execute();
  } catch (error) {
    console.error("Error fetching collected wastes:", error);
    return [];
  }
}

export async function createNotification(userId: number, message: string, type: string) {
  try {
    const [notification] = await db
      .insert(Notifications)
      .values({ userId, message, type })
      .returning()
      .execute();
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
}

export async function getUnreadNotifications(userId: number) {
  try {
    return await db.select().from(Notifications).where(
      and(
        eq(Notifications.userId, userId),
        eq(Notifications.isRead, false)
      )
    ).execute();
  } catch (error) {
    console.error("Error fetching unread notifications:", error);
    return [];
  }
}

export async function markNotificationAsRead(notificationId: number) {
  try {
    await db.update(Notifications).set({ isRead: true }).where(eq(Notifications.id, notificationId)).execute();
  } catch (error) {
    console.error("Error marking notification as read:", error);
  }
}

export async function getPendingReports() {
  try {
    return await db.select().from(Reports).where(eq(Reports.status, "pending")).execute();
  } catch (error) {
    console.error("Error fetching pending reports:", error);
    return [];
  }
}

export async function updateReportStatus(reportId: number, status: string) {
  try {
    const [updatedReport] = await db
      .update(Reports)
      .set({ status })
      .where(eq(Reports.id, reportId))
      .returning()
      .execute();
    return updatedReport;
  } catch (error) {
    console.error("Error updating report status:", error);
    return null;
  }
}

export async function getRecentReports(limit: number = 10) {
  try {
    const reports = await db
      .select()
      .from(Reports)
      .orderBy(desc(Reports.createdAt))
      .limit(limit)
      .execute();
    return reports;
  } catch (error) {
    console.error("Error fetching recent reports:", error);
    return [];
  }
}

export async function getWasteCollectionTasks(limit: number = 20) {
  try {
    const tasks = await db
      .select({
        id: Reports.id,
        userId: Reports.userId,
        location: Reports.location,
        wasteType: Reports.wasteType,
        amount: Reports.amount,
        status: Reports.status,
        date: Reports.createdAt,
        collectorId: Reports.collectorId,
      })
      .from(Reports)
      .limit(limit)
      .execute();

    return tasks.map(task => ({
      ...task,
      date: task.date.toISOString().split('T')[0], // Format date as YYYY-MM-DD
    }));
  } catch (error) {
    console.error("Error fetching waste collection tasks:", error);
    return [];
  }
}

export async function saveReward(userId: number, amount: number) {
  try {
    await getOrCreateReward(userId);
    const reward = await updateRewardPoints(userId, amount);
    await createTransaction(userId, 'earned_collect', amount, 'Points earned for collecting waste');
    await createNotification(
      userId,
      `You've earned ${amount} points for collecting waste!`,
      'reward'
    );
    return reward;
  } catch (error) {
    console.error("Error saving reward:", error);
    throw error;
  }
}

export async function saveCollectedWaste(reportId: number, collectorId: number, verificationResult: any) {
  try {
    await assertCollectorNotReporter(reportId, collectorId);
    const [collectedWaste] = await db
      .insert(CollectedWastes)
      .values({
        reportId,
        collectorId,
        collectionDate: new Date(),
        status: 'verified',
      })
      .returning()
      .execute();
    return collectedWaste;
  } catch (error) {
    console.error("Error saving collected waste:", error);
    throw error;
  }
}

export async function updateTaskStatus(reportId: number, newStatus: string, collectorId?: number) {
  try {
    if (collectorId !== undefined) {
      await assertCollectorNotReporter(reportId, collectorId);
    }
    const updateData: any = { status: newStatus };
    if (collectorId !== undefined) {
      updateData.collectorId = collectorId;
    }
    const [updatedReport] = await db
      .update(Reports)
      .set(updateData)
      .where(eq(Reports.id, reportId))
      .returning()
      .execute();
    return updatedReport;
  } catch (error) {
    console.error("Error updating task status:", error);
    throw error;
  }
}

export async function getAllRewards() {
  try {
    const balanceExpr = sql<number>`COALESCE(SUM(CASE WHEN ${Transactions.type} LIKE 'earned%' THEN ${Transactions.amount} ELSE -${Transactions.amount} END), 0)`;
    const rows = await db
      .select({
        userId: Transactions.userId,
        points: balanceExpr,
        userName: Users.name,
      })
      .from(Transactions)
      .leftJoin(Users, eq(Transactions.userId, Users.id))
      .groupBy(Transactions.userId, Users.name)
      .having(sql`${balanceExpr} > 0`)
      .orderBy(desc(balanceExpr))
      .execute();

    return rows.map((row) => ({
      id: row.userId,
      userId: row.userId,
      points: Number(row.points),
      level: Math.floor(Number(row.points) / 100) + 1,
      createdAt: new Date(),
      userName: row.userName,
    }));
  } catch (error) {
    console.error("Error fetching all rewards:", error);
    return [];
  }
}

export async function getRewardTransactions(userId: number) {
  try {
    console.log('Fetching transactions for user ID:', userId)
    const transactions = await db
      .select({
        id: Transactions.id,
        type: Transactions.type,
        amount: Transactions.amount,
        description: Transactions.description,
        date: Transactions.date,
      })
      .from(Transactions)
      .where(eq(Transactions.userId, userId))
      .orderBy(desc(Transactions.date))
      .limit(10)
      .execute();

    console.log('Raw transactions from database:', transactions)

    const formattedTransactions = transactions.map(t => ({
      ...t,
      date: t.date.toISOString().split('T')[0], // Format date as YYYY-MM-DD
    }));

    console.log('Formatted transactions:', formattedTransactions)
    return formattedTransactions;
  } catch (error) {
    console.error("Error fetching reward transactions:", error);
    return [];
  }
}

export async function getAvailableRewards(userId: number) {
  try {
    console.log('Fetching available rewards for user:', userId);
    
    const userPoints = await getUserBalance(userId);

    console.log('User total points:', userPoints);

    // Get available rewards from the database
    const dbRewards = await db
      .select({
        id: Rewards.id,
        name: Rewards.name,
        cost: Rewards.points,
        description: Rewards.description,
        collectionInfo: Rewards.collectionInfo,
      })
      .from(Rewards)
      .where(and(eq(Rewards.isAvailable, true), ne(Rewards.name, 'Default Reward')))
      .execute();

    console.log('Rewards from database:', dbRewards);

    // Combine user points and database rewards
    const allRewards = [
      {
        id: 0, // Use a special ID for user's points
        name: "Your Points",
        cost: userPoints,
        description: "Redeem your earned points",
        collectionInfo: "Points earned from reporting and collecting waste"
      },
      ...dbRewards
    ];

    console.log('All available rewards:', allRewards);
    return allRewards;
  } catch (error) {
    console.error("Error fetching available rewards:", error);
    return [];
  }
}

export async function createTransaction(userId: number, type: 'earned_report' | 'earned_collect' | 'redeemed', amount: number, description: string) {
  try {
    const [transaction] = await db
      .insert(Transactions)
      .values({ userId, type, amount, description })
      .returning()
      .execute();
    return transaction;
  } catch (error) {
    console.error("Error creating transaction:", error);
    throw error;
  }
}

export async function redeemReward(userId: number, rewardId: number) {
  try {
    const userReward = await getOrCreateReward(userId) as any;
    
    if (rewardId === 0) {
      // Redeem all points
      const [updatedReward] = await db.update(Rewards)
        .set({ 
          points: 0,
          updatedAt: new Date(),
        })
        .where(eq(Rewards.userId, userId))
        .returning()
        .execute();

      // Create a transaction for this redemption
      await createTransaction(userId, 'redeemed', userReward.points, `Redeemed all points: ${userReward.points}`);

      return updatedReward;
    } else {
      // Existing logic for redeeming specific rewards
      const availableReward = await db.select().from(Rewards).where(eq(Rewards.id, rewardId)).execute();

      if (!userReward || !availableReward[0] || userReward.points < availableReward[0].points) {
        throw new Error("Insufficient points or invalid reward");
      }

      const [updatedReward] = await db.update(Rewards)
        .set({ 
          points: sql`${Rewards.points} - ${availableReward[0].points}`,
          updatedAt: new Date(),
        })
        .where(eq(Rewards.userId, userId))
        .returning()
        .execute();

      // Create a transaction for this redemption
      await createTransaction(userId, 'redeemed', availableReward[0].points, `Redeemed: ${availableReward[0].name}`);

      return updatedReward;
    }
  } catch (error) {
    console.error("Error redeeming reward:", error);
    throw error;
  }
}

export async function getUserBalance(userId: number): Promise<number> {
  try {
    const [row] = await db
      .select({
        balance: sql<number>`COALESCE(SUM(CASE WHEN ${Transactions.type} LIKE 'earned%' THEN ${Transactions.amount} ELSE -${Transactions.amount} END), 0)`,
      })
      .from(Transactions)
      .where(eq(Transactions.userId, userId))
      .execute();
    return Math.max(Number(row?.balance ?? 0), 0);
  } catch (error) {
    console.error('Error fetching user balance:', error);
    return 0;
  }
}

