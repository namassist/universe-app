package id.universe.mobile.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.universe.mobile.ui.theme.Theme

/** Not built for iOS yet (docs/prd.md, Mobile app): the NIK is typed instead. */
@Composable
actual fun QrCamera(onCode: (String) -> Unit, modifier: Modifier, overlay: @Composable BoxScope.() -> Unit) {
    Box(modifier.padding(24.dp), contentAlignment = Alignment.Center) {
        Txt(
            "Kamera belum tersedia di iOS. Ketik NIK manual.",
            Theme.type.callout,
            color = ViewfinderInk,
            align = TextAlign.Center,
        )
    }
}
