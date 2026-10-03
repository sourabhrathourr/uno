import { useCallback, useEffect, useRef, useState } from "react"
import {
  createVoiceFilterContext,
  createVoiceFilterPipeline,
} from "./voice-filter-audio"
import { getVoiceFilter } from "./voice-filter-presets"
import type { VoiceFilterPipeline } from "./voice-filter-audio"
import type { VoiceFilterId } from "./voice-filter-presets"

export type VoiceFilterControls = {
  filter: VoiceFilterId
  filterError: string | null
  setFilter: (id: VoiceFilterId) => void
}

export function useVoiceFilters() {
  const [filter, setFilterState] = useState<VoiceFilterId>("normal")
  const [filterError, setFilterError] = useState<string | null>(null)
  const filterRef = useRef<VoiceFilterId>("normal")
  const pipelineRef = useRef<VoiceFilterPipeline | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const generationRef = useRef(0)

  const fail = useCallback(() => {
    filterRef.current = "normal"
    setFilterState("normal")
    setFilterError("Filters are unavailable. Your normal voice still works.")
  }, [])

  const setFilter = useCallback((value: VoiceFilterId) => {
    const id = getVoiceFilter(value).id
    filterRef.current = id
    setFilterState(id)
    pipelineRef.current?.setFilter(id)
  }, [])

  // Called from the mic tap, before any network or permission awaits.
  const prepareFilters = useCallback(() => {
    if (pipelineRef.current) {
      void pipelineRef.current.resume().catch(fail)
      return
    }
    if (contextRef.current) return
    try {
      contextRef.current = createVoiceFilterContext()
      void contextRef.current.resume().catch(fail)
    } catch {
      fail()
    }
  }, [fail])

  const stopFilters = useCallback((preservePreparedContext = false) => {
    generationRef.current++
    pipelineRef.current?.close()
    pipelineRef.current = null
    if (!preservePreparedContext) {
      if (contextRef.current) void contextRef.current.close().catch(() => {})
      contextRef.current = null
    }
  }, [])

  const attachFilters = useCallback(
    async (raw: MediaStream) => {
      const generation = ++generationRef.current
      pipelineRef.current?.close()
      pipelineRef.current = null
      try {
        const context = contextRef.current ?? createVoiceFilterContext()
        contextRef.current = context
        const pipeline = await createVoiceFilterPipeline(
          raw,
          filterRef.current,
          fail,
          context
        )
        if (contextRef.current === context) contextRef.current = null
        if (generation !== generationRef.current) {
          pipeline.close()
          throw new DOMException("Voice session ended", "AbortError")
        }
        pipeline.setFilter(filterRef.current)
        pipelineRef.current = pipeline
        setFilterError(null)
      } catch (cause) {
        if (generation !== generationRef.current) throw cause
        contextRef.current = null
        fail()
      }
    },
    [fail]
  )

  const muteFilters = useCallback((muted: boolean) => {
    pipelineRef.current?.setMuted(muted)
  }, [])
  const getFilteredStream = useCallback(
    () => pipelineRef.current?.stream ?? null,
    []
  )

  useEffect(() => stopFilters, [stopFilters])

  return {
    filter,
    filterError,
    setFilter,
    prepareFilters,
    attachFilters,
    stopFilters,
    muteFilters,
    getFilteredStream,
  }
}
