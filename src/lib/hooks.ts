import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage } from './format'

interface ActionOptions<T> {
  /** Query keys to refetch after success. */
  invalidate?: QueryKey[]
  /** Toast text on success; omit for silent success. */
  success?: string | ((result: T) => string)
  onSuccess?: (result: T) => void
}

/** A mutation that refreshes related queries and reports the outcome as a toast. */
export function useAction<V, T = unknown>(fn: (vars: V) => Promise<T>, opts: ActionOptions<T> = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await Promise.all((opts.invalidate ?? []).map((queryKey) => qc.invalidateQueries({ queryKey })))
      if (opts.success) toast.success(typeof opts.success === 'string' ? opts.success : opts.success(result))
      opts.onSuccess?.(result)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}
