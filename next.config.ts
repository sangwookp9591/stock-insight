import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export', // Tauri는 정적 파일만 싣는다
  images: { unoptimized: true }, // 정적 export는 next/image 최적화 불가
}

export default nextConfig
