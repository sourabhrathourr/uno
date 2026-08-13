import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { Check } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import type * as React from "react"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-[4px] border border-white/14 bg-neutral-950/70 text-neutral-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[background-color,border-color,box-shadow,opacity,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/55 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-neutral-950/55 disabled:text-transparent disabled:opacity-100 data-[checked]:border-yellow-200/85 data-[checked]:bg-yellow-300 data-[checked]:text-neutral-950 data-[checked]:shadow-[0_0_0_1px_rgba(250,204,21,0.18),0_0_14px_rgba(250,204,21,0.18)]",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        data-slot="checkbox-indicator"
        className="data-[checked]:blur-0 grid size-3 scale-[0.25] place-items-center text-neutral-950 opacity-0 blur-[4px] transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] data-[checked]:scale-100 data-[checked]:opacity-100"
      >
        <Check className="size-2.5" strokeWidth={3.25} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
