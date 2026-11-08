import * as RadioGroup from "@radix-ui/react-radio-group";

/** Every option stays visible so a variant is one click away, not a menu away. */
export function ExampleChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <RadioGroup.Root
        aria-label={label}
        value={value}
        onValueChange={(next) => {
          const option = options.find((item) => item.value === next);
          if (option) onChange(option.value);
        }}
        className="flex flex-wrap gap-1.5"
      >
        {options.map((option) => (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            className="cursor-pointer rounded-md border border-input px-2.5 py-1 text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=checked]:border-foreground data-[state=checked]:bg-state-active data-[state=checked]:text-foreground"
          >
            {option.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
