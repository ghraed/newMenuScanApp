package com.menuscanapp

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class HeadingSensorModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext),
  SensorEventListener,
  LifecycleEventListener {

  private val sensorManager: SensorManager =
    reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val rotationVectorSensor: Sensor? =
    sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
  @Suppress("DEPRECATION")
  private val orientationSensor: Sensor? =
    sensorManager.getDefaultSensor(Sensor.TYPE_ORIENTATION)

  private val rotationMatrix = FloatArray(9)
  private val orientationAngles = FloatArray(3)

  private var startedByJs = false
  private var listening = false

  override fun getName(): String = "HeadingSensorModule"

  init {
    reactContext.addLifecycleEventListener(this)
  }

  @ReactMethod
  fun start() {
    startedByJs = true
    registerSensorListener()
  }

  @ReactMethod
  fun stop() {
    startedByJs = false
    unregisterSensorListener()
  }

  // Required by RN event emitter contract for native modules.
  @ReactMethod
  fun addListener(eventName: String) {}

  // Required by RN event emitter contract for native modules.
  @ReactMethod
  fun removeListeners(count: Int) {}

  @Suppress("DEPRECATION")
  override fun onSensorChanged(event: SensorEvent?) {
    val sensorType = event?.sensor?.type ?: return
    val heading = when (sensorType) {
      Sensor.TYPE_ROTATION_VECTOR -> calculateHeadingFromRotationVector(event)
      Sensor.TYPE_ORIENTATION -> normalizeHeading(event.values[0].toDouble())
      else -> null
    }

    if (heading == null) {
      return
    }

    val payload = Arguments.createMap().apply {
      putDouble("heading", heading)
      putDouble("timestamp", System.currentTimeMillis().toDouble())
    }

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_HEADING_SAMPLE, payload)
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onHostResume() {
    if (startedByJs) {
      registerSensorListener()
    }
  }

  override fun onHostPause() {
    unregisterSensorListener()
  }

  override fun onHostDestroy() {
    unregisterSensorListener()
    reactContext.removeLifecycleEventListener(this)
  }

  private fun registerSensorListener() {
    if (listening) {
      return
    }

    val sensor = rotationVectorSensor ?: orientationSensor ?: return

    listening = sensorManager.registerListener(
      this,
      sensor,
      SensorManager.SENSOR_DELAY_GAME,
    )
  }

  private fun unregisterSensorListener() {
    if (!listening) {
      return
    }

    sensorManager.unregisterListener(this)
    listening = false
  }

  companion object {
    const val EVENT_HEADING_SAMPLE = "HeadingSensorSample"
  }

  private fun calculateHeadingFromRotationVector(event: SensorEvent): Double {
    SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
    SensorManager.getOrientation(rotationMatrix, orientationAngles)
    return normalizeHeading(Math.toDegrees(orientationAngles[0].toDouble()))
  }

  private fun normalizeHeading(value: Double): Double {
    var normalized = value % 360.0
    if (normalized < 0) {
      normalized += 360.0
    }
    return normalized
  }
}
