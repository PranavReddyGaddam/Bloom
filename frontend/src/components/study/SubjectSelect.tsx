'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { api, APIError } from '@/lib/api'
import { Subject } from '@/types'

const NEW_SUBJECT_VALUE = '__new_subject__'

interface SubjectSelectProps {
  subjectId: string | null
  onSelect: (subject: Subject) => void
  labelHtmlFor?: string
}

export function SubjectSelect({ subjectId, onSelect, labelHtmlFor }: SubjectSelectProps) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  const loadSubjects = () => {
    api.getSubjects()
      .then((result) => {
        setSubjects(result)
        // Force creation first: if there are no subjects yet, or the
        // currently selected one no longer exists, open the create form.
        if (result.length === 0) {
          setCreating(true)
        }
      })
      .catch((err) => setError(err instanceof APIError ? err.message : 'Failed to load subjects'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadSubjects()
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setError('')
    try {
      const subject = await api.createSubject(newName.trim())
      setNewName('')
      setCreating(false)
      setSubjects((prev) => {
        const exists = prev.some((s) => s.id === subject.id)
        return exists ? prev : [...prev, subject].sort((a, b) => a.name.localeCompare(b.name))
      })
      onSelect(subject)
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to create subject')
    }
  }

  const handleSelectChange = (value: string) => {
    if (value === NEW_SUBJECT_VALUE) {
      setCreating(true)
      return
    }
    const subject = subjects.find((s) => s.id === value)
    if (subject) onSelect(subject)
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium text-white/70">Subject</Label>
        <div className="h-10 rounded-md bg-white/5 border border-white/20 animate-pulse" />
      </div>
    )
  }

  if (creating || subjects.length === 0) {
    return (
      <div className="space-y-2">
        <Label htmlFor={labelHtmlFor} className="text-sm font-medium text-white/70">
          {subjects.length === 0 ? 'Create your first subject' : 'New subject'}
        </Label>
        <div className="flex gap-2">
          <Input
            id={labelHtmlFor}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="e.g. Deep Learning"
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
          />
          <Button
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="bg-[#D7FF3D] text-black hover:bg-[#c2e836] shrink-0"
          >
            Create
          </Button>
          {subjects.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreating(false)}
              className="border-white/20 bg-white/5 text-white hover:bg-white/10 shrink-0"
            >
              Cancel
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={labelHtmlFor} className="text-sm font-medium text-white/70">Subject</Label>
      <Select value={subjectId ?? undefined} onValueChange={handleSelectChange}>
        <SelectTrigger className="bg-white/5 border-white/20 text-white">
          <SelectValue placeholder="Select a subject" />
        </SelectTrigger>
        <SelectContent className="bg-[#0d1230] border-white/15 text-white">
          {subjects.map((subject) => (
            <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>
          ))}
          <SelectItem value={NEW_SUBJECT_VALUE}>
            <span className="flex items-center gap-1.5 text-[#D7FF3D]">
              <Plus className="h-3.5 w-3.5" />
              New subject
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  )
}
