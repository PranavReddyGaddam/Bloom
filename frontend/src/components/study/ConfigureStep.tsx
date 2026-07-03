'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { StudyFormData, SummaryType, Difficulty, Subject } from '@/types'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { SubjectSelect } from './SubjectSelect'

const LIME_BG = 'bg-[#D7FF3D]'

interface ConfigureStepProps {
  formData: StudyFormData
  setFormData: React.Dispatch<React.SetStateAction<StudyFormData>>
  loading: boolean
  handleGenerate: () => void
  setCurrentStep: (step: 'upload' | 'configure' | 'results') => void
  resetApp: () => void
}

export function ConfigureStep({
  formData,
  setFormData,
  loading,
  handleGenerate,
  setCurrentStep,
  resetApp
}: ConfigureStepProps) {
  const router = useRouter()

  return (
    <div>
      {/* Header */}
      <header className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCurrentStep('upload')
                  router.push('/upload')
                }}
                className="text-white/60 hover:text-white hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </div>
            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetApp()
                  window.location.reload()
                }}
                className="text-white/60 hover:text-white hover:bg-white/10"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <ProfileAvatar />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-8">
          <h2 className="font-serif text-2xl font-light text-white mb-6">
            Customize your summary and quiz preferences
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="summary-type" className="text-sm font-medium text-white/70">Summary Format</Label>
              <Select
                value={formData.summaryType}
                onValueChange={(value: SummaryType) =>
                  setFormData(prev => ({ ...prev, summaryType: value }))
                }
              >
                <SelectTrigger className="bg-white/5 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                  <SelectItem value="short">Short (2-3 paragraphs)</SelectItem>
                  <SelectItem value="bullet_points">Bullet Points</SelectItem>
                  <SelectItem value="detailed">Detailed Summary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <SubjectSelect
              labelHtmlFor="subject"
              subjectId={formData.subjectId}
              onSelect={(subject: Subject) =>
                setFormData(prev => ({ ...prev, subjectId: subject.id, subjectName: subject.name }))
              }
            />

            <div className="space-y-2">
              <Label htmlFor="num-questions" className="text-sm font-medium text-white/70">Number of Questions</Label>
              <Select
                value={formData.numQuestions.toString()}
                onValueChange={(value) =>
                  setFormData(prev => ({ ...prev, numQuestions: parseInt(value) }))
                }
              >
                <SelectTrigger className="bg-white/5 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map(num => (
                    <SelectItem key={num} value={num.toString()}>{num} questions</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="difficulty" className="text-sm font-medium text-white/70">Difficulty Level</Label>
              <Select
                value={formData.difficulty}
                onValueChange={(value: Difficulty) =>
                  setFormData(prev => ({ ...prev, difficulty: value }))
                }
              >
                <SelectTrigger className="bg-white/5 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                  <SelectItem value="easy">Easy (Basic concepts)</SelectItem>
                  <SelectItem value="medium">Medium (Mixed)</SelectItem>
                  <SelectItem value="hard">Hard (Critical thinking)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </main>

      {/* Generate Button */}
      <div className="fixed bottom-6 right-6 z-20">
        <Button
          onClick={handleGenerate}
          disabled={loading}
          size="lg"
          className={`${LIME_BG} text-black hover:bg-[#c2e836] px-8 py-3 rounded-full shadow-lg`}
        >
          {loading ? (
            <>
              <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
              Generating...
            </>
          ) : (
            'Generate'
          )}
        </Button>
      </div>
    </div>
  )
}
