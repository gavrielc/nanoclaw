use crate::drivers::DisplayRotation;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GpioPin(pub u8);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BoardConfig {
    pub name: &'static str,
    pub display: DisplayLayout,
    pub touch: TouchLayout,
    pub audio: AudioPins,
    pub rotation: DisplayRotation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DisplayLayout {
    pub qspi_cs: GpioPin,
    pub qspi_sclk: GpioPin,
    pub qspi_sdo: GpioPin,
    pub qspi_sdi: GpioPin,
    pub reset: Option<GpioPin>,
    pub backlight: GpioPin,
    pub width: u16,
    pub height: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TouchLayout {
    pub i2c_sda: GpioPin,
    pub i2c_scl: GpioPin,
    pub irq: GpioPin,
    pub reset: Option<GpioPin>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioPins {
    pub i2s_bclk: GpioPin,
    pub i2s_ws: GpioPin,
    pub i2s_sd: GpioPin,
    pub i2s_dout: GpioPin,
    pub imu_sda: GpioPin,
    pub imu_scl: GpioPin,
}

pub const WAVESHARE_1_85C_V3: BoardConfig = BoardConfig {
    name: "Waveshare ESP32-S3-Touch-LCD 1.85C",
    display: DisplayLayout {
        qspi_cs: GpioPin(21),
        qspi_sclk: GpioPin(42),
        qspi_sdo: GpioPin(46),
        qspi_sdi: GpioPin(45),
        reset: None,
        backlight: GpioPin(5),
        width: 360,
        height: 360,
    },
    touch: TouchLayout {
        i2c_sda: GpioPin(11),
        i2c_scl: GpioPin(10),
        irq: GpioPin(4),
        reset: None,
    },
    audio: AudioPins {
        i2s_bclk: GpioPin(19),
        i2s_ws: GpioPin(20),
        i2s_sd: GpioPin(18),
        i2s_dout: GpioPin(17),
        imu_sda: GpioPin(11),
        imu_scl: GpioPin(10),
    },
    rotation: DisplayRotation::Portrait,
};
