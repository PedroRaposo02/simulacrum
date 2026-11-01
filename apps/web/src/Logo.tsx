export default function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className={className} />;
}
