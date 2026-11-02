export function Loading({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="flex items-center gap-3 text-gray-500">
        <div className="h-5 w-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        <span className="text-sm font-medium">{text}</span>
      </div>
    </div>
  )
}
