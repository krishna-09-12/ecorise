'use client'
import { useState, useEffect } from 'react'
import { Coins, ArrowUpRight, ArrowDownRight, Gift, AlertCircle, Loader } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUserByEmail, getRewardTransactions, getAvailableRewards, redeemReward, getUserBalance } from '@/utils/db/actions'
import { toast } from 'react-hot-toast'

type Transaction = {
  id: number
  type: 'earned_report' | 'earned_collect' | 'redeemed'
  amount: number
  description: string
  date: string
}

type Reward = {
  id: number
  name: string
  cost: number
  description: string | null
  collectionInfo: string
}

export default function RewardsPage() {
  const [user, setUser] = useState<{ id: number; email: string; name: string } | null>(null)
  const [balance, setBalance] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)
  const [redeemingId, setRedeemingId] = useState<number | null>(null)

  useEffect(() => {
    const fetchUserDataAndRewards = async () => {
      setLoading(true)
      try {
        const userEmail = localStorage.getItem('userEmail')
        if (userEmail) {
          const fetchedUser = await getUserByEmail(userEmail)
          if (fetchedUser) {
            setUser(fetchedUser)
            const fetchedTransactions = await getRewardTransactions(fetchedUser.id)
            setTransactions(fetchedTransactions as Transaction[])
            const fetchedRewards = await getAvailableRewards(fetchedUser.id)
            setRewards(fetchedRewards.filter(r => r.cost > 0)) // Filter out rewards with 0 points
            const calculatedBalance = await getUserBalance(fetchedUser.id)
            setBalance(calculatedBalance)
          } else {
            toast.error('User not found. Please log in again.', { id: 'auth-toast' })
          }
        } else {
          toast.error('User not logged in. Please log in.', { id: 'auth-toast' })
        }
      } catch (error) {
        console.error('Error fetching user data and rewards:', error)
        toast.error('Failed to load rewards data. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchUserDataAndRewards()
  }, [])

  const handleRedeemReward = async (rewardId: number) => {
    if (!user) {
      toast.error('Please log in to redeem rewards.')
      return
    }
    setRedeemingId(rewardId);

    const reward = rewards.find(r => r.id === rewardId)
    if (reward && balance >= reward.cost && reward.cost > 0) {
      try {
        if (balance < reward.cost) {
          toast.error('Insufficient balance to redeem this reward')
          return
        }

        // Update database
        await redeemReward(user.id, rewardId);

        await refreshUserData();

        toast.success(`You have successfully redeemed: ${reward.name}`)
      } catch (error) {
        console.error('Error redeeming reward:', error)
        toast.error('Failed to redeem reward. Please try again.')
      }
    } else {
      toast.error('Insufficient balance or invalid reward cost')
    }
    setRedeemingId(null);
  }

  const handleRedeemAllPoints = async () => {
    if (!user) {
      toast.error('Please log in to redeem points.');
      return;
    }
    setRedeemingId(0);

    if (balance > 0) {
      try {
        // Update database
        await redeemReward(user.id, 0);

        await refreshUserData();

        toast.success(`You have successfully redeemed all your points!`);
      } catch (error) {
        console.error('Error redeeming all points:', error);
        toast.error('Failed to redeem all points. Please try again.');
      }
    } else {
      toast.error('No points available to redeem')
    }
    setRedeemingId(null);
  }

  const refreshUserData = async () => {
    if (user) {
      const fetchedUser = await getUserByEmail(user.email);
      if (fetchedUser) {
        const fetchedTransactions = await getRewardTransactions(fetchedUser.id);
        setTransactions(fetchedTransactions as Transaction[]);
        const fetchedRewards = await getAvailableRewards(fetchedUser.id);
        setRewards(fetchedRewards.filter(r => r.cost > 0)); // Filter out rewards with 0 points
        
        // Recalculate balance
        const calculatedBalance = await getUserBalance(fetchedUser.id)
        setBalance(calculatedBalance) // Ensure balance is never negative
      }
    }
  }

  if (loading) {
    return <div className="flex justify-center items-center h-64">
      <Loader className="animate-spin h-8 w-8 text-gray-600" />
    </div>
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold mb-6 text-foreground">Rewards</h1>
      
      <div className="bg-card text-card-foreground p-6 rounded-xl shadow-lg flex flex-col justify-between h-full border-l-4 border-green-500 mb-8">
        <h2 className="text-xl font-semibold mb-4">Reward Balance</h2>
        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center">
            <Coins className="w-10 h-10 mr-3 text-green-500" />
            <div>
              <span className="text-4xl font-bold text-green-500">{balance}</span>
              <p className="text-sm text-muted-foreground">Available Points</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">Recent Transactions</h2>
          <div className="bg-card text-card-foreground rounded-xl shadow-md overflow-hidden">
            {transactions.length > 0 ? (
              transactions.map(transaction => (
                <div key={transaction.id} className="flex items-center justify-between p-4 border-b border-border last:border-b-0">
                  <div className="flex items-center">
                    {transaction.type === 'earned_report' ? (
                      <ArrowUpRight className="w-5 h-5 text-green-500 mr-3" />
                    ) : transaction.type === 'earned_collect' ? (
                      <ArrowUpRight className="w-5 h-5 text-blue-500 mr-3" />
                    ) : (
                      <ArrowDownRight className="w-5 h-5 text-red-500 mr-3" />
                    )}
                    <div>
                      <p className="font-medium text-foreground">{transaction.description}</p>
                      <p className="text-sm text-muted-foreground">{transaction.date}</p>
                    </div>
                  </div>
                  <span className={`font-semibold ${transaction.type.startsWith('earned') ? 'text-green-500' : 'text-red-500'}`}>
                    {transaction.type.startsWith('earned') ? '+' : '-'}{transaction.amount}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-muted-foreground">No transactions yet</div>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">Available Rewards</h2>
          <div className="space-y-4">
            {rewards.length > 0 ? (
              rewards.map(reward => (
                <div key={reward.id} className="bg-card border border-border p-4 rounded-xl shadow-md">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-semibold text-foreground">{reward.name}</h3>
                    <span className="text-green-500 font-semibold">{reward.cost} points</span>
                  </div>
                  <p className="text-muted-foreground mb-2">{reward.description}</p>
                  <p className="text-sm text-muted-foreground mb-4">{reward.collectionInfo}</p>
                  {reward.id === 0 ? (
                    <div className="space-y-2">
                      <Button 
                        onClick={handleRedeemAllPoints}
                        className="w-full bg-green-500 hover:bg-green-600 text-white"
                        disabled={balance === 0 || redeemingId !== null}
                      >
                        {redeemingId === 0 ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : <Gift className="w-4 h-4 mr-2" />}
                        {redeemingId === 0 ? 'Redeeming...' : 'Redeem All Points'}
                      </Button>
                    </div>
                  ) : (
                    <Button 
                      onClick={() => handleRedeemReward(reward.id)}
                      className="w-full bg-green-500 hover:bg-green-600 text-white"
                      disabled={balance < reward.cost || redeemingId !== null}
                    >
                      {redeemingId === reward.id ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : <Gift className="w-4 h-4 mr-2" />}
                      {redeemingId === reward.id ? 'Redeeming...' : 'Redeem Reward'}
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 p-4 rounded-md">
                <div className="flex items-center">
                  <AlertCircle className="h-6 w-6 text-yellow-400 mr-3" />
                  <p className="text-yellow-700 dark:text-yellow-500">No rewards available at the moment.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}