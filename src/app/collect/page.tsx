'use client'
import { useState, useEffect } from 'react'
import { Trash2, MapPin, CheckCircle, Clock, ArrowRight, Camera, Upload, Loader, Calendar, Weight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'react-hot-toast'
import { getWasteCollectionTasks, updateTaskStatus, saveReward, saveCollectedWaste, getUserByEmail } from '@/utils/db/actions'
import { GoogleGenerativeAI } from "@google/generative-ai"
import { normalizeConfidence, parseGeminiJsonResponse } from '@/utils/geminiJson'

// Make sure to set your Gemini API key in your environment variables
const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY
const geminiModel = process.env.NEXT_PUBLIC_GEMINI_MODEL || 'gemini-2.0-flash'

type CollectionTask = {
  id: number
  userId: number
  location: string
  wasteType: string
  amount: string
  status: 'pending' | 'in_progress' | 'completed' | 'verified'
  date: string
  collectorId: number | null
}

const ITEMS_PER_PAGE = 5

export default function CollectPage() {
  const [tasks, setTasks] = useState<CollectionTask[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredWasteType, setHoveredWasteType] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [user, setUser] = useState<{ id: number; email: string; name: string } | null>(null)
  const [showNearby, setShowNearby] = useState(false)
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null)
  const [processingId, setProcessingId] = useState<number | null>(null)

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c; // Distance in km
  };

  const extractCoordinates = (location: string) => {
    const match = location.match(/\(Lat:\s*([-\d.]+),\s*Lng:\s*([-\d.]+)\)/i);
    return match ? { lat: parseFloat(match[1]), lng: parseFloat(match[2]) } : null;
  };

  const handleShowNearby = () => {
    if (showNearby) {
      setShowNearby(false);
      return;
    }
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setShowNearby(true);
      },
      () => toast.error('Could not get your location. Check permissions.')
    );
  };

  useEffect(() => {
    const fetchUserAndTasks = async () => {
      setLoading(true)
      try {
        // Fetch user
        const userEmail = localStorage.getItem('userEmail')
        if (userEmail) {
          const fetchedUser = await getUserByEmail(userEmail)
          if (fetchedUser) {
            setUser(fetchedUser)
          } else {
            toast.error('User not found. Please log in again.', { id: 'auth-toast' })
            // Redirect to login page or handle this case appropriately
          }
        }

        // Fetch tasks
        const fetchedTasks = await getWasteCollectionTasks()
        setTasks(fetchedTasks as CollectionTask[])
      } catch (error) {
        console.error('Error fetching user and tasks:', error)
        toast.error('Failed to load user data and tasks. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchUserAndTasks()
  }, [])

  const [selectedTask, setSelectedTask] = useState<CollectionTask | null>(null)
  const [verificationImage, setVerificationImage] = useState<string | null>(null)
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'success' | 'failure'>('idle')
  const [verificationResult, setVerificationResult] = useState<{
    wasteTypeMatch: boolean;
    quantityMatch: boolean;
    confidence: number;
  } | null>(null)
  const [reward, setReward] = useState<number | null>(null)

  const handleStatusChange = async (taskId: number, newStatus: CollectionTask['status']) => {
    if (!user) {
      toast.error('Please sign in from the header to collect waste.', { id: 'auth-toast' })
      return
    }

    const task = tasks.find((t) => t.id === taskId)
    if (task && task.userId === user.id) {
      toast.error('You cannot collect waste you reported. Ask another collector.')
      return
    }

    setProcessingId(taskId);

    try {
      const updatedTask = await updateTaskStatus(taskId, newStatus, user.id)
      if (updatedTask) {
        setTasks(tasks.map(task => 
          task.id === taskId ? { ...task, status: newStatus, collectorId: user.id } : task
        ))
        toast.success('Task status updated successfully')
      } else {
        toast.error('Failed to update task status. Please try again.')
      }
    } catch (error) {
      console.error('Error updating task status:', error)
      const message = error instanceof Error ? error.message : 'Failed to update task status. Please try again.'
      toast.error(message)
    } finally {
      setProcessingId(null);
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setVerificationImage(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const readFileAsBase64 = (dataUrl: string): string => {
    return dataUrl.split(',')[1]
  }

  const handleVerify = async () => {
    if (!selectedTask || !verificationImage || !user) {
      toast.error('Missing required information for verification.')
      return
    }

    if (selectedTask.userId === user.id) {
      toast.error('You cannot collect waste you reported. Ask another collector.')
      return
    }

    setVerificationStatus('verifying')
    
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey!)
      const model = genAI.getGenerativeModel({ model: geminiModel })

      const base64Data = readFileAsBase64(verificationImage)

      const imageParts = [
        {
          inlineData: {
            data: base64Data,
            mimeType: 'image/jpeg', // Adjust this if you know the exact type
          },
        },
      ]

      const prompt = `You are an expert in waste management and recycling. Analyze this image and provide:
        1. Confirm if the waste type matches: ${selectedTask.wasteType}
        2. Estimate if the quantity matches: ${selectedTask.amount}
        3. Your confidence level in this assessment (as a percentage)
        
        Respond in JSON format like this:
        {
          "wasteTypeMatch": true/false,
          "quantityMatch": true/false,
          "confidence": confidence level as a number between 0 and 1
        }`

      const result = await model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = response.text()
      
      try {
        const parsedResult = parseGeminiJsonResponse(text)
        const wasteTypeMatch = Boolean(parsedResult.wasteTypeMatch)
        const quantityMatch = Boolean(parsedResult.quantityMatch)
        const confidence = normalizeConfidence(parsedResult.confidence)
        setVerificationResult({
          wasteTypeMatch,
          quantityMatch,
          confidence,
        })
        setVerificationStatus('success')
        
        if (wasteTypeMatch && quantityMatch && confidence > 0.7) {
          await handleStatusChange(selectedTask.id, 'verified')
          const earnedReward = Math.floor(Math.random() * 50) + 10 // Random reward between 10 and 59
          
          // Save the reward
          await saveReward(user.id, earnedReward)

          // Save the collected waste
          await saveCollectedWaste(selectedTask.id, user.id, {
            wasteTypeMatch,
            quantityMatch,
            confidence,
          })

          setReward(earnedReward)
          toast.success(`Verification successful! You earned ${earnedReward} tokens!`, {
            duration: 5000,
            position: 'top-center',
          })
        } else {
          toast.error('Verification failed. The collected waste does not match the reported waste.', {
            duration: 5000,
            position: 'top-center',
          })
        }
      } catch (error) {
        console.log(error);
        
        console.error('Failed to parse JSON response:', text)
        setVerificationStatus('failure')
      }
    } catch (error) {
      console.error('Error verifying waste:', error)
      setVerificationStatus('failure')
    }
  }

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.location.toLowerCase().includes(searchTerm.toLowerCase());
    if (!showNearby || !userLocation) return matchesSearch;
    
    const coords = extractCoordinates(task.location);
    if (!coords) return false; // If we can't find coords, hide it when 'nearby' is checked
    
    const dist = calculateDistance(userLocation.lat, userLocation.lng, coords.lat, coords.lng);
    return matchesSearch && dist <= 10; // 10km max
  })

  const pageCount = Math.ceil(filteredTasks.length / ITEMS_PER_PAGE)
  const paginatedTasks = filteredTasks.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold mb-6 text-foreground">Waste Collection Tasks</h1>
      
      <div className="mb-4 flex items-center">
        <Input
          type="text"
          placeholder="Search by area..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mr-2"
        />
        <Button variant="outline" size="icon" className="mr-2">
          <Search className="h-4 w-4" />
        </Button>
        <Button variant={showNearby ? "default" : "outline"} onClick={handleShowNearby}>
          <MapPin className="h-4 w-4 mr-2" />
          {showNearby ? "Showing Nearby (10km)" : "Show Nearby"}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader className="animate-spin h-8 w-8 text-gray-500" />
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {paginatedTasks.map(task => (
              <div key={task.id} className="bg-card text-card-foreground p-4 rounded-lg shadow-sm border border-border">
                <div className="flex justify-between items-start mb-2 gap-2">
                  <h2 className="text-lg font-medium flex items-center flex-1 min-w-0">
                    <MapPin className="w-5 h-5 mr-2 text-muted-foreground shrink-0" />
                    <span className="truncate" title={task.location}>{task.location}</span>
                  </h2>
                  <div className="shrink-0">
                    <StatusBadge status={task.status} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-muted-foreground mb-3">
                  <div className="flex items-center relative">
                    <Trash2 className="w-4 h-4 mr-2" />
                    <span 
                      onMouseEnter={() => setHoveredWasteType(task.wasteType)}
                      onMouseLeave={() => setHoveredWasteType(null)}
                      className="cursor-pointer"
                    >
                      {task.wasteType.length > 8 ? `${task.wasteType.slice(0, 8)}...` : task.wasteType}
                    </span>
                    {hoveredWasteType === task.wasteType && (
                      <div className="absolute left-0 top-full mt-1 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-10">
                        {task.wasteType}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center">
                    <Weight className="w-4 h-4 mr-2" />
                    {task.amount}
                  </div>
                  <div className="flex items-center">
                    <Calendar className="w-4 h-4 mr-2" />
                    {task.date}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 mt-4">
                  <Button 
                    onClick={() => {
                      const coords = extractCoordinates(task.location);
                      const url = coords 
                        ? `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`
                        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(task.location)}`;
                      window.open(url, '_blank');
                    }} 
                    variant="outline" 
                    size="sm"
                  >
                    <MapPin className="w-4 h-4 mr-1" />
                    Directions
                  </Button>

                  {task.status === 'pending' && task.userId === user?.id && (
                    <span className="text-muted-foreground text-sm flex items-center">Your report</span>
                  )}
                  {task.status === 'pending' && task.userId !== user?.id && (
                    <Button 
                      onClick={() => handleStatusChange(task.id, 'in_progress')} 
                      variant="default" 
                      size="sm"
                      disabled={processingId !== null}
                    >
                      {processingId === task.id ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Start Collection
                    </Button>
                  )}
                  {task.status === 'in_progress' && task.collectorId === user?.id && (
                    <Button 
                      onClick={() => setSelectedTask(task)} 
                      variant="default" 
                      size="sm"
                      disabled={processingId !== null}
                    >
                      Complete & Verify
                    </Button>
                  )}
                  {task.status === 'in_progress' && task.collectorId !== user?.id && (
                    <span className="text-yellow-600 text-sm font-medium flex items-center">In progress by someone else</span>
                  )}
                  {task.status === 'verified' && (
                    <span className="text-green-600 text-sm font-medium flex items-center">Reward Earned</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-center">
            <Button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="mr-2"
            >
              Previous
            </Button>
            <span className="mx-2 self-center">
              Page {currentPage} of {pageCount}
            </span>
            <Button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, pageCount))}
              disabled={currentPage === pageCount}
              className="ml-2"
            >
              Next
            </Button>
          </div>
        </>
      )}

      {selectedTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card text-card-foreground rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">Verify Collection</h3>
            <p className="mb-4 text-sm text-muted-foreground">Upload a photo of the collected waste to verify and earn your reward.</p>
            <div className="mb-4">
              <label htmlFor="verification-image" className="block text-sm font-medium mb-2">
                Upload Image
              </label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-border border-dashed rounded-md">
                <div className="space-y-1 text-center">
                  <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
                  <div className="flex justify-center text-sm">
                    <label
                      htmlFor="verification-image"
                      className="relative cursor-pointer rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500"
                    >
                      <span>Upload a file</span>
                      <input id="verification-image" name="verification-image" type="file" className="sr-only" onChange={handleImageUpload} accept="image/*" />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">PNG, JPG, GIF up to 10MB</p>
                </div>
              </div>
            </div>
            {verificationImage && (
              <img src={verificationImage} alt="Verification" className="mb-4 rounded-md w-full" />
            )}
            <Button
              onClick={handleVerify}
              className="w-full"
              disabled={!verificationImage || verificationStatus === 'verifying'}
            >
              {verificationStatus === 'verifying' ? (
                <>
                  <Loader className="animate-spin -ml-1 mr-3 h-5 w-5" />
                  Verifying...
                </>
              ) : 'Verify Collection'}
            </Button>
            {verificationStatus === 'success' && verificationResult && (
              <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md text-green-800 dark:text-green-300">
                <p>Waste Type Match: {verificationResult.wasteTypeMatch ? 'Yes' : 'No'}</p>
                <p>Quantity Match: {verificationResult.quantityMatch ? 'Yes' : 'No'}</p>
                <p>Confidence: {(verificationResult.confidence * 100).toFixed(2)}%</p>
              </div>
            )}
            {verificationStatus === 'failure' && (
              <p className="mt-2 text-red-600 text-center text-sm">Verification failed. Please try again.</p>
            )}
            <Button onClick={() => setSelectedTask(null)} variant="outline" className="w-full mt-2">
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Add a conditional render to show user info or login prompt */}
      {/* {user ? (
        <p className="text-sm text-gray-600 mb-4">Logged in as: {user.name}</p>
      ) : (
        <p className="text-sm text-red-600 mb-4">Please log in to collect waste and earn rewards.</p>
      )} */}
    </div>
  )
}

function StatusBadge({ status }: { status: CollectionTask['status'] }) {
  const statusConfig = {
    pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock },
    in_progress: { color: 'bg-blue-100 text-blue-800', icon: Trash2 },
    completed: { color: 'bg-green-100 text-green-800', icon: CheckCircle },
    verified: { color: 'bg-purple-100 text-purple-800', icon: CheckCircle },
  }

  const { color, icon: Icon } = statusConfig[status]

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${color} flex items-center`}>
      <Icon className="mr-1 h-3 w-3" />
      {status.replace('_', ' ')}
    </span>
  )
}