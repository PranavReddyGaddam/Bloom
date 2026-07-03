import Grainient from '@/components/Grainient'

export function PageBackground() {
  return (
    <div className="fixed inset-0 z-0 h-screen w-screen bg-[#0d1230]">
      <Grainient
        timeSpeed={0.2}
        colorBalance={0}
        warpStrength={1}
        warpFrequency={4}
        warpSpeed={1.5}
        warpAmplitude={55}
        blendAngle={0}
        blendSoftness={0.08}
        rotationAmount={400}
        noiseScale={1.6}
        grainAmount={0.09}
        grainScale={2}
        grainAnimated={false}
        contrast={1.35}
        gamma={1}
        saturation={1}
        centerX={0}
        centerY={0}
        zoom={1.1}
        color1="#0d1230"
        color2="#6f93dd"
        color3="#1a2568"
      />
    </div>
  )
}
