/**
 * 图蒙版的采样变换：把 {@link MaskImageParams} 的位移 / 缩放 / 旋转换算成着色器要的三个量
 * ——蒙版图中心、在卡面上的宽高（卡面等比坐标，卡高 = 1）、旋转（弧度）。
 *
 * 与图层图片效果的变换同构（见 mask-sample 在 `shaders/common.ts` 里的 `maskSampleUv`）：
 * 中心是平移项、旋转绕中心、正角 = 屏幕顺时针。尺寸先按填充方式取（与底图共用
 * {@link fitSpan}），再乘用户缩放；缺省是 `cover`，与底图一致。
 *
 * 所有入参都按「非法即恒等」兜底：schema 有默认值，但材质是外部可写的，NaN / Infinity / 0
 * 一旦漏进来会变成 NaN 坐标或除零，症状是整层蒙版静默消失。
 */
import type { FrontFit } from "@prismwright/schema"
import { fitSpan } from "./front-uv"

/** 着色器的蒙版采样参数。 */
export interface MaskUvParams {
  /** 蒙版图中心（卡面等比坐标，卡高 = 1；正 = 右 / 上）。 */
  centerX: number
  /** 蒙版图中心（卡面等比坐标，卡高 = 1；正 = 右 / 上）。 */
  centerY: number
  /** 蒙版图在卡面上的宽度（卡面等比坐标）。 */
  sizeX: number
  /** 蒙版图在卡面上的高度（卡面等比坐标）。 */
  sizeY: number
  /** 旋转弧度（正 = 屏幕顺时针）。 */
  rotation: number
}

/** 参与换算的蒙版变换字段（缺省值见 {@link maskUvParams}）。 */
export interface MaskTransform {
  x?: number
  y?: number
  scale?: number
  rotation?: number
  /** 填充方式。缺省 `"cover"`（与底图一致）。 */
  fit?: FrontFit
}

/** 有限数才采纳，否则取兜底值。 */
function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/**
 * 把蒙版变换换算成着色器参数。
 *
 * 缺省（无蒙版 / 恒等）时中心在卡心、尺寸正好是卡面、不旋转——旧系列插画的孔洞位置不变。
 *
 * @param aspect - 卡片宽高比（宽 / 高）；非法值按 1 兜底。
 * @param mask - 图蒙版参数；缺省即恒等。
 * @param imageAspect - 蒙版图的自然宽高比（宽 / 高）。缺省 / 非法时按卡面比例兜底，
 *   于是 cover / contain 都退化为拉伸——纹理没解码时不至于把蒙版裁掉或缩没。
 */
export function maskUvParams(
  aspect: number,
  mask?: MaskTransform | null,
  imageAspect?: number,
): MaskUvParams {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const ia = Number.isFinite(imageAspect) && (imageAspect as number) > 0 ? (imageAspect as number) : a
  // 缩放必须为正：0 / 负数 / NaN 都会让蒙版尺寸退化（除零或镜像），按 1 兜底。
  const scaleValue = finiteOr(mask?.scale, 1)
  const scale = scaleValue > 0 ? scaleValue : 1
  // 填充方式决定基准尺寸（卡面单位），用户缩放叠在它之上。
  const [width, height] = fitSpan(ia, a, mask?.fit ?? "cover")
  return {
    centerX: finiteOr(mask?.x, 0),
    centerY: finiteOr(mask?.y, 0),
    sizeX: width * scale,
    sizeY: height * scale,
    rotation: (finiteOr(mask?.rotation, 0) * Math.PI) / 180,
  }
}
