import Grainient from '@/components/Grainient';

export function GrainientPage() {
  return (
    <div className="h-screen w-full relative">
      <Grainient
        timeSpeed={0.25}
        colorBalance={0}
        warpStrength={1}
        warpFrequency={5}
        warpSpeed={2}
        warpAmplitude={50}
        blendAngle={0}
        blendSoftness={0.05}
        rotationAmount={500}
        noiseScale={2}
        grainAmount={0.1}
        grainScale={2}
        grainAnimated={false}
        contrast={1.5}
        gamma={1}
        saturation={1}
        centerX={0}
        centerY={0}
        zoom={0.9}
        color1="#3B82F6"
        color2="#F0F9FF"
        color3="#60A5FA"
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <h1 className="text-8xl font-bold text-black/60 tracking-wider">Grainient</h1>
      </div>
    </div>
  );
}
