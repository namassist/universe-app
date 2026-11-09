package id.universe.mobile.ui.components

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

/** Text on the dark viewfinder, in both themes. */
val ViewfinderInk = Color(0xFFC9D3E6)

/**
 * The camera reading QR codes on the device itself, so a gate with no signal
 * still reads a card. Each raw value is handed to [onCode] as it is read, many
 * times a second while a card is held up. It asks for the camera itself, and
 * draws [overlay] over the picture only once the picture is there.
 */
@Composable
expect fun QrCamera(onCode: (String) -> Unit, modifier: Modifier = Modifier, overlay: @Composable BoxScope.() -> Unit = {})
