import type { Weather } from '../types';
import { SeededRandom, valueNoise1D } from '../utils/random';
import { angleDeltaDeg, wrapDeg, windVector } from '../utils/math';
import type { WindState } from './effects';

/** Synthetic coastal weather: slow drift around operator-set baselines. */
export class WeatherModel {
  baseDir = 315;
  baseSpeed = 12;
  private rng = new SeededRandom('encirra-weather');
  private dirOffset = 0;
  private speedOffset = 0;
  /** low-pass filtered direction used for plume orientation (plumes swing gradually) */
  smoothDir = 315;
  current: Weather = {
    windDir: 315,
    windSpeed: 12,
    gust: 16,
    temperature: 33.4,
    humidity: 52,
    pressure: 1009.6,
    visibility: 9.6,
    stability: 'D',
  };

  setBaseline(dir: number, speed: number) {
    this.baseDir = wrapDeg(dir);
    this.baseSpeed = Math.max(1, speed);
  }

  step(t: number, dtSec: number) {
    // Ornstein–Uhlenbeck style wobble
    this.dirOffset += -0.08 * this.dirOffset * dtSec + 1.1 * Math.sqrt(dtSec) * this.rng.gauss();
    this.speedOffset += -0.1 * this.speedOffset * dtSec + 0.32 * Math.sqrt(dtSec) * this.rng.gauss();
    this.dirOffset = Math.max(-9, Math.min(9, this.dirOffset));
    this.speedOffset = Math.max(-2.5, Math.min(2.5, this.speedOffset));
    const dir = wrapDeg(this.baseDir + this.dirOffset);
    const speed = Math.max(0.5, this.baseSpeed + this.speedOffset);
    const k = 1 - Math.exp(-dtSec / 9);
    this.smoothDir = wrapDeg(this.smoothDir + angleDeltaDeg(this.smoothDir, dir) * k);
    const minutes = t / 60000;
    this.current = {
      windDir: dir,
      windSpeed: speed,
      gust: speed * (1.32 + 0.08 * valueNoise1D(minutes * 3, 3)),
      temperature: 33.4 + 0.9 * valueNoise1D(minutes / 7, 1),
      humidity: 52 + 4 * valueNoise1D(minutes / 9, 2),
      pressure: 1009.6 + 0.6 * valueNoise1D(minutes / 15, 4),
      visibility: 9.6 + 0.3 * valueNoise1D(minutes / 11, 5),
      stability: speed > 18 ? 'C' : speed < 6 ? 'E' : 'D',
    };
  }

  /** wind state for dispersion models (uses the smoothed direction) */
  windState(): WindState {
    const v = windVector(this.smoothDir);
    return { tx: v.x, tz: v.z, speed: this.current.windSpeed / 3.6 };
  }
}
