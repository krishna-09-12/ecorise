'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Upload, CheckCircle, Loader, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createUser, getUserByEmail, createReport, getRecentReports } from '@/utils/db/actions';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { normalizeConfidence, parseGeminiJsonResponse } from '@/utils/geminiJson';

const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const geminiModel = process.env.NEXT_PUBLIC_GEMINI_MODEL || 'gemini-2.0-flash';
const hasGemini = Boolean(geminiApiKey);

export default function ReportPage() {
  const [user, setUser] = useState<{ id: number; email: string; name: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [reports, setReports] = useState<
    Array<{
      id: number;
      location: string;
      wasteType: string;
      amount: string;
      createdAt: string;
    }>
  >([]);

  const [newReport, setNewReport] = useState({
    location: '',
    type: '',
    amount: '',
  });

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'success' | 'failure'>('idle');
  const [verificationResult, setVerificationResult] = useState<{
    wasteType: string;
    quantity: string;
    confidence: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewReport((prev) => ({ ...prev, [name]: value }));
  };

  const applyImageFile = useCallback((selectedFile: File) => {
    if (!selectedFile.type.startsWith('image/')) {
      toast.error('Please choose an image file (PNG, JPG, etc.).');
      return;
    }
    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreview(ev.target?.result as string);
    };
    reader.onerror = () => {
      toast.error('Could not read that file.');
      setFile(null);
      setPreview(null);
    };
    reader.readAsDataURL(selectedFile);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) applyImageFile(f);
    e.target.value = '';
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) applyImageFile(f);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const readFileAsBase64 = (f: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });
  };

  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported in this browser.');
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`);
          const data = await res.json();
          const address = data.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
          setNewReport((prev) => ({ ...prev, location: `${address} (Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)})` }));
          setGeoLoading(false);
          toast.success('Location added from your device.');
        } catch (err) {
          setNewReport((prev) => ({ ...prev, location: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` }));
          setGeoLoading(false);
          toast.success('Location coordinates added.');
        }
      },
      () => {
        setGeoLoading(false);
        toast.error('Could not read location. Check permissions or type a location instead.');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60_000 }
    );
  };

  const handleVerify = async () => {
    if (!hasGemini) {
      toast.error('AI verification is not configured. Use “Confirm waste details” below.');
      return;
    }
    if (!file) {
      toast.error('Choose an image first.');
      return;
    }
    setVerificationStatus('verifying');

    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey!);
      const model = genAI.getGenerativeModel({ model: geminiModel });

      const base64Data = await readFileAsBase64(file);
      const comma = base64Data.indexOf(',');
      const rawBase64 = comma >= 0 ? base64Data.slice(comma + 1) : base64Data;
      const mimeType = file.type || 'image/jpeg';

      const imageParts = [
        {
          inlineData: {
            data: rawBase64,
            mimeType,
          },
        },
      ];

      const prompt = `You are an expert in waste management and recycling. Analyze this image and provide:
        1. The type of waste (e.g., plastic, paper, glass, metal, organic)
        2. An estimate of the quantity or amount (in kg or liters)
        3. Your confidence level in this assessment (as a percentage)
        
        Respond in JSON format like this:
        {
          "wasteType": "type of waste",
          "quantity": "estimated quantity with unit",
          "confidence": confidence level as a number between 0 and 1
        }`;

      const result = await model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      const text = response.text();

      try {
        const parsed = parseGeminiJsonResponse(text);
        const wasteType = String(parsed.wasteType ?? '').trim();
        const quantity = String(parsed.quantity ?? parsed.amount ?? '').trim();
        const confidence = normalizeConfidence(parsed.confidence);
        if (wasteType && quantity) {
          setVerificationResult({ wasteType, quantity, confidence });
          setVerificationStatus('success');
          setNewReport((prev) => ({
            ...prev,
            type: wasteType,
            amount: quantity,
          }));
          toast.success('AI verification complete.');
        } else {
          console.error('Invalid verification result:', parsed);
          setVerificationStatus('failure');
          toast.error('AI response was missing type or quantity. Try again or use manual confirm.');
        }
      } catch {
        console.error('Failed to parse JSON response:', text);
        setVerificationStatus('failure');
        toast.error('Could not read AI response. Use “Confirm waste details” or try again.');
      }
    } catch (error) {
      console.error('Error verifying waste:', error);
      setVerificationStatus('failure');
      toast.error('AI verification failed. Check your API key or use manual confirm.');
    }
  };

  const handleManualConfirm = () => {
    if (!newReport.location.trim() || !newReport.type.trim() || !newReport.amount.trim()) {
      toast.error('Enter location, waste type, and amount.');
      return;
    }
    setVerificationResult({
      wasteType: newReport.type,
      quantity: newReport.amount,
      confidence: 1,
    });
    setVerificationStatus('success');
    toast.success('Details confirmed — you can submit the report.');
  };

  const formatReportDate = (d: Date | string) => {
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return String(d).split('T')[0];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authReady) {
      toast.error('Still loading your account. Please wait a moment.');
      return;
    }
    if (!user) {
      toast.error('You need to be signed in (use Login in the header), then open this page again.');
      return;
    }
    if (verificationStatus !== 'success' || !verificationResult) {
      toast.error('Confirm waste details (or run AI verify) before submitting.');
      return;
    }
    if (!newReport.location.trim() || !newReport.type.trim() || !newReport.amount.trim()) {
      toast.error('Location, type, and amount are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const imagePayload =
        preview && preview.length > 11_000_000
          ? undefined
          : preview || undefined;
      if (preview && preview.length > 11_000_000) {
        toast('Image is very large; submitting without storing the photo.', { icon: 'ℹ️' });
      }

      const report = await createReport(
        user.id,
        newReport.location.trim(),
        newReport.type.trim(),
        newReport.amount.trim(),
        imagePayload,
        verificationResult
      );

      if (!report) {
        toast.error('Failed to submit report. Please try again.');
        return;
      }

      const formattedReport = {
        id: report.id,
        location: report.location,
        wasteType: report.wasteType,
        amount: report.amount,
        createdAt: formatReportDate(report.createdAt as Date),
      };

      setReports([formattedReport, ...reports]);
      setNewReport({ location: '', type: '', amount: '' });
      setFile(null);
      setPreview(null);
      setVerificationStatus('idle');
      setVerificationResult(null);

      toast.success(`Report submitted successfully! You've earned points for reporting waste.`);
    } catch (error) {
      console.error('Error submitting report:', error);
      toast.error('Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const checkUser = async () => {
      setAuthReady(false);
      const email = localStorage.getItem('userEmail');
      if (email) {
        let u = await getUserByEmail(email);
        if (!u) {
          const created = await createUser(email, 'Anonymous User');
          u = created ?? (await getUserByEmail(email));
        }
        setUser(u);
        if (!u) {
          toast.error('Could not load your account. Try signing in again from the header.', { id: 'auth-toast' });
        }

        const recentReports = await getRecentReports();
        const formattedReports = recentReports.map((report) => ({
          ...report,
          createdAt: formatReportDate(report.createdAt as Date),
        }));
        setReports(formattedReports);
      } else {
        toast.error('Please sign in from the header to report waste.', { id: 'auth-toast' });
        router.push('/');
      }
      setAuthReady(true);
    };
    checkUser();
  }, [router]);

  const fieldsLockedByAi = hasGemini && verificationStatus === 'success';

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold mb-6 text-foreground">Report waste</h1>

      <form onSubmit={handleSubmit} className="bg-card text-card-foreground p-6 sm:p-8 rounded-2xl shadow-lg mb-12">
        <div className="mb-8">
          <p className="block text-lg font-medium mb-2">Upload waste image</p>
          <input
            ref={fileInputRef}
            id="waste-image"
            name="waste-image"
            type="file"
            className="sr-only"
            onChange={handleFileChange}
            accept="image/*,.heic,.heif"
          />
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
              }
            }}
            onClick={openFilePicker}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-border border-dashed rounded-xl hover:border-green-500 transition-colors duration-300 cursor-pointer"
          >
            <div className="space-y-1 text-center pointer-events-none">
              <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
              <div className="flex flex-wrap justify-center text-sm gap-1">
                <span className="font-medium text-green-600">Click to choose a file</span>
                <span className="text-muted-foreground">or drag and drop here</span>
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPG, WebP, HEIC, etc.</p>
            </div>
          </div>
        </div>

        {preview && (
          <div className="mt-4 mb-8">
            <img src={preview} alt="Waste preview" className="max-w-full h-auto rounded-xl shadow-md" />
          </div>
        )}

        {hasGemini ? (
          <Button
            type="button"
            onClick={handleVerify}
            className="w-full mb-4 bg-blue-600 hover:bg-blue-700 text-white py-3 text-lg rounded-xl transition-colors duration-300"
            disabled={!file || verificationStatus === 'verifying'}
          >
            {verificationStatus === 'verifying' ? (
              <>
                <Loader className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
                Verifying...
              </>
            ) : (
              'Verify waste with AI'
            )}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground mb-4">
            AI image verification is optional. Enter waste type and amount below, then use <strong>Confirm waste details</strong>.
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={handleManualConfirm}
          className="w-full mb-8 py-3 text-lg rounded-xl border-green-600 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
        >
          Confirm waste details
        </Button>

        {verificationStatus === 'success' && verificationResult && (
          <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 p-4 mb-8 rounded-r-xl">
            <div className="flex items-center">
              <CheckCircle className="h-6 w-6 text-green-400 mr-3" />
              <div>
                <h3 className="text-lg font-medium text-green-800 dark:text-green-300">Ready to submit</h3>
                <div className="mt-2 text-sm text-green-700 dark:text-green-400">
                  <p>Waste Type: {verificationResult.wasteType}</p>
                  <p>Quantity: {verificationResult.quantity}</p>
                  {hasGemini && (
                    <p>
                      Confidence:{' '}
                      {(verificationResult.confidence <= 1
                        ? verificationResult.confidence * 100
                        : verificationResult.confidence
                      ).toFixed(2)}
                      %
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="md:col-span-2">
            <label htmlFor="location" className="block text-sm font-medium mb-1">
              Location
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                id="location"
                name="location"
                value={newReport.location}
                onChange={handleInputChange}
                required
                className="flex-1 px-4 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300"
                placeholder="Landmark, or address "
              />
              <Button type="button" variant="outline" onClick={handleUseLocation} disabled={geoLoading} className="shrink-0">
                {geoLoading ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Navigation className="h-4 w-4 mr-2" />
                    Use my location
                  </>
                )}
              </Button>
            </div>
          </div>
          <div>
            <label htmlFor="type" className="block text-sm font-medium mb-1">
              Waste Type
            </label>
            <input
              type="text"
              id="type"
              name="type"
              value={newReport.type}
              onChange={handleInputChange}
              required
              readOnly={fieldsLockedByAi}
              className={`w-full px-4 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300 ${
                fieldsLockedByAi ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              placeholder="e.g. plastic, organic"
            />
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium mb-1">
              Estimated Amount
            </label>
            <input
              type="text"
              id="amount"
              name="amount"
              value={newReport.amount}
              onChange={handleInputChange}
              required
              readOnly={fieldsLockedByAi}
              className={`w-full px-4 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300 ${
                fieldsLockedByAi ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              placeholder="e.g. 2 kg"
            />
          </div>
        </div>
        <Button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-700 text-white py-3 text-lg rounded-xl transition-colors duration-300 flex items-center justify-center"
          disabled={isSubmitting || !authReady || !user}
        >
          {isSubmitting ? (
            <>
              <Loader className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
              Submitting...
            </>
          ) : (
            'Submit Report'
          )}
        </Button>
      </form>

      <h2 className="text-3xl font-semibold mb-6 text-foreground">Recent Reports</h2>
      <div className="bg-card text-card-foreground rounded-2xl shadow-lg overflow-hidden">
        <div className="max-h-96 overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-muted/50 transition-colors duration-200">
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center max-w-[200px] sm:max-w-[300px]">
                      <MapPin className="shrink-0 w-4 h-4 mr-2 text-green-500" />
                      <span className="truncate" title={report.location}>{report.location}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{report.wasteType}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{report.amount}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{report.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
