/**
 * Red "OFF" / green "ON" pill switch, sized to sit beside the toolbar icon
 * buttons. The knob slides to the side opposite the label.
 */
export default function AutoParseSwitch({
  checked,
  onChange,
  disabled = false,
  busy = false,
  title,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** A save is in flight; the switch ignores clicks. */
  busy?: boolean
  title: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Auto-parse"
      title={title}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[46px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed ${
        disabled ? 'opacity-40' : ''
      } ${busy ? 'cursor-wait' : ''} ${
        checked
          ? 'border-emerald-700 bg-emerald-600'
          : 'border-red-700 bg-red-600'
      }`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 flex items-center text-[9px] font-extrabold uppercase leading-none tracking-wide text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.25)] ${
          checked ? 'left-[6px]' : 'right-[5px]'
        }`}
      >
        {checked ? 'On' : 'Off'}
      </span>
      <span
        aria-hidden
        className={`absolute top-1/2 h-[14px] w-[18px] -translate-y-1/2 rounded-full bg-gradient-to-b from-white to-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-all duration-200 ${
          checked ? 'left-[24px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}
