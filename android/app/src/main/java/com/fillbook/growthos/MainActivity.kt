package com.fillbook.growthos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.fillbook.growthos.data.CrashReporter
import com.fillbook.growthos.data.NetworkGrowthOsRepository
import com.fillbook.growthos.data.TokenStore
import com.fillbook.growthos.ui.screens.AnalyticsScreen
import com.fillbook.growthos.ui.screens.ApprovalsScreen
import com.fillbook.growthos.ui.screens.CampaignsScreen
import com.fillbook.growthos.ui.screens.ContentLibraryScreen
import com.fillbook.growthos.ui.screens.CreatorsScreen
import com.fillbook.growthos.ui.screens.HomeScreen
import com.fillbook.growthos.ui.screens.InboundScreen
import com.fillbook.growthos.ui.screens.LoginScreen
import com.fillbook.growthos.ui.screens.RadarScreen
import com.fillbook.growthos.ui.screens.ResearchScreen
import com.fillbook.growthos.ui.screens.SettingsScreen
import com.fillbook.growthos.ui.screens.StrategyScreen
import com.fillbook.growthos.ui.screens.SystemScreen
import com.fillbook.growthos.ui.theme.Border
import com.fillbook.growthos.ui.theme.FillbookGrowthOSTheme
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary

private sealed class Destination(val route: String, val label: String, val icon: ImageVector) {
    data object Home : Destination("home", "Home", Icons.Filled.Home)
    data object Radar : Destination("radar", "Radar", Icons.Filled.Radar)
    data object Approvals : Destination("approvals", "Approvals", Icons.Filled.CheckCircle)
    data object Inbound : Destination("inbound", "Inbound", Icons.Filled.Forum)
    data object Campaigns : Destination("campaigns", "Campaigns", Icons.Filled.Campaign)
    data object Analytics : Destination("analytics", "Analytics", Icons.Filled.Insights)
    data object ContentLibrary : Destination("content_library", "Content Library", Icons.Filled.VideoLibrary)
    data object Research : Destination("research", "Research", Icons.Filled.Science)
    data object Creators : Destination("creators", "Creators", Icons.Filled.Groups)
    data object Strategy : Destination("strategy", "Strategy", Icons.Filled.Timeline)
    data object System : Destination("system", "System", Icons.Filled.Dns)
    data object Settings : Destination("settings", "Settings", Icons.Filled.Settings)
}

/** The 4 screens worth a permanent thumb-reach slot -- everything else lives in More. */
private val primaryDestinations = listOf(Destination.Home, Destination.Radar, Destination.Approvals, Destination.Analytics)

/** Secondary screens: real but lower-frequency, reached via the More sheet instead of eating a nav slot. */
private val moreDestinations = listOf(
    Destination.Inbound,
    Destination.Campaigns,
    Destination.ContentLibrary,
    Destination.Creators,
    Destination.System,
    Destination.Settings,
    Destination.Research,
    Destination.Strategy,
)

private val allDestinations = primaryDestinations + moreDestinations

private const val BASE_URL = "https://fillbook-growth-os.vercel.app"

/**
 * See NetworkGrowthOsRepository's kdoc: this is a Vercel deployment-
 * protection bypass token, not the Supabase service_role key -- safe to
 * embed client-side by design. It gets the app's requests PAST Vercel's
 * deployment protection; it is not what authorizes them against this
 * project's own data. That's TokenStore's job now (see LoginScreen).
 */
private const val PROTECTION_BYPASS_SECRET = "7TVBpvTPeeHbiGlZco9RDS8miXqtbfoi"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val tokenStore = TokenStore(this)
        CrashReporter.install(this, BASE_URL, PROTECTION_BYPASS_SECRET, tokenStore)
        setContent {
            FillbookGrowthOSTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    GrowthOsRoot(tokenStore)
                }
            }
        }
    }
}

@Composable
private fun GrowthOsRoot(tokenStore: TokenStore) {
    var appToken by remember { mutableStateOf(tokenStore.getToken()) }
    var displayName by remember { mutableStateOf(tokenStore.getDisplayName()) }

    val token = appToken
    if (token == null) {
        LoginScreen(
            baseUrl = BASE_URL,
            protectionBypassSecret = PROTECTION_BYPASS_SECRET,
            onLoginSuccess = { validatedToken, validatedName ->
                tokenStore.saveToken(validatedToken)
                tokenStore.saveDisplayName(validatedName)
                appToken = validatedToken
                displayName = validatedName
            },
        )
    } else {
        val repo = remember(token) {
            NetworkGrowthOsRepository(BASE_URL, PROTECTION_BYPASS_SECRET, token, displayName ?: "")
        }
        GrowthOsApp(
            repo = repo,
            onLogout = {
                tokenStore.clearToken()
                appToken = null
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GrowthOsApp(repo: com.fillbook.growthos.data.GrowthOsRepository, onLogout: () -> Unit) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination
    var showMore by remember { mutableStateOf(false) }

    fun navigate(route: String) {
        navController.navigate(route) {
            popUpTo(navController.graph.startDestinationId) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                primaryDestinations.forEach { destination ->
                    val selected = currentDestination?.hierarchy?.any { it.route == destination.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = { navigate(destination.route) },
                        icon = { Icon(destination.icon, contentDescription = destination.label) },
                        label = { Text(destination.label) },
                    )
                }
                val onMoreScreen = moreDestinations.any { d -> currentDestination?.hierarchy?.any { it.route == d.route } == true }
                NavigationBarItem(
                    selected = onMoreScreen,
                    onClick = { showMore = true },
                    icon = { Icon(Icons.Filled.MoreHoriz, contentDescription = "More") },
                    label = { Text("More") },
                )
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Destination.Home.route,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(Destination.Home.route) { HomeScreen(repo, onNavigate = ::navigate) }
            composable(Destination.Radar.route) { RadarScreen(repo) }
            composable(Destination.Approvals.route) { ApprovalsScreen(repo) }
            composable(Destination.Inbound.route) { InboundScreen(repo) }
            composable(Destination.Campaigns.route) { CampaignsScreen(repo) }
            composable(Destination.Analytics.route) { AnalyticsScreen(repo) }
            composable(Destination.ContentLibrary.route) { ContentLibraryScreen(repo) }
            composable(Destination.Research.route) { ResearchScreen() }
            composable(Destination.Creators.route) { CreatorsScreen(repo) }
            composable(Destination.Strategy.route) { StrategyScreen() }
            composable(Destination.System.route) { SystemScreen(repo) }
            composable(Destination.Settings.route) { SettingsScreen(repo, onLogout = onLogout) }
        }
    }

    if (showMore) {
        val sheetState = rememberModalBottomSheetState()
        ModalBottomSheet(onDismissRequest = { showMore = false }, sheetState = sheetState) {
            Text(
                "More",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            HorizontalDivider(color = Border)
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                modifier = Modifier.padding(12.dp),
            ) {
                items(moreDestinations) { destination ->
                    MoreGridItem(destination.label, destination.icon) {
                        showMore = false
                        navigate(destination.route)
                    }
                }
            }
        }
    }
}

@Composable
private fun MoreGridItem(label: String, icon: ImageVector, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .padding(6.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .clickable(onClick = onClick)
            .padding(vertical = 18.dp, horizontal = 8.dp),
        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = TextPrimary)
        androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextSecondary, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
