package com.fillbook.growthos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.fillbook.growthos.data.NetworkGrowthOsRepository
import com.fillbook.growthos.ui.screens.AnalyticsScreen
import com.fillbook.growthos.ui.screens.ApprovalsScreen
import com.fillbook.growthos.ui.screens.CampaignsScreen
import com.fillbook.growthos.ui.screens.ContentLibraryScreen
import com.fillbook.growthos.ui.screens.CreatorsScreen
import com.fillbook.growthos.ui.screens.HomeScreen
import com.fillbook.growthos.ui.screens.RadarScreen
import com.fillbook.growthos.ui.screens.ResearchScreen
import com.fillbook.growthos.ui.screens.SettingsScreen
import com.fillbook.growthos.ui.screens.StrategyScreen
import com.fillbook.growthos.ui.screens.SystemScreen
import com.fillbook.growthos.ui.theme.FillbookGrowthOSTheme
import kotlinx.coroutines.launch

private sealed class Destination(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    data object Home : Destination("home", "Home", Icons.Filled.Home)
    data object Radar : Destination("radar", "Radar", Icons.Filled.Radar)
    data object Approvals : Destination("approvals", "Approvals", Icons.Filled.CheckCircle)
    data object Campaigns : Destination("campaigns", "Campaigns", Icons.Filled.Campaign)
    data object Analytics : Destination("analytics", "Analytics", Icons.Filled.Insights)
    data object ContentLibrary : Destination("content_library", "Content Library", Icons.Filled.VideoLibrary)
    data object Research : Destination("research", "Research", Icons.Filled.Science)
    data object Creators : Destination("creators", "Creators", Icons.Filled.Groups)
    data object Strategy : Destination("strategy", "Strategy", Icons.Filled.Timeline)
    data object System : Destination("system", "System", Icons.Filled.Dns)
    data object Settings : Destination("settings", "Settings", Icons.Filled.Settings)
}

private val destinations = listOf(
    Destination.Home,
    Destination.Radar,
    Destination.Approvals,
    Destination.Campaigns,
    Destination.Analytics,
    Destination.ContentLibrary,
    Destination.Research,
    Destination.Creators,
    Destination.Strategy,
    Destination.System,
    Destination.Settings,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // See NetworkGrowthOsRepository's kdoc: this is a Vercel deployment-
        // protection bypass token, not the Supabase service_role key --
        // safe to embed client-side by design. The Supabase key itself
        // never appears in this app.
        val repo = NetworkGrowthOsRepository(
            baseUrl = "https://fillbook-growth-os.vercel.app",
            protectionBypassSecret = "7TVBpvTPeeHbiGlZco9RDS8miXqtbfoi",
        )
        setContent {
            FillbookGrowthOSTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    GrowthOsApp(repo)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GrowthOsApp(repo: com.fillbook.growthos.data.GrowthOsRepository) {
    val navController = rememberNavController()
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination
    val currentLabel = destinations.firstOrNull { d ->
        currentDestination?.hierarchy?.any { it.route == d.route } == true
    }?.label ?: "Fillbook Growth OS"

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Text(
                    "Fillbook Growth OS",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(16.dp),
                )
                destinations.forEach { destination ->
                    val selected = currentDestination?.hierarchy?.any { it.route == destination.route } == true
                    NavigationDrawerItem(
                        label = { Text(destination.label) },
                        icon = { Icon(destination.icon, contentDescription = null) },
                        selected = selected,
                        onClick = {
                            scope.launch { drawerState.close() }
                            navController.navigate(destination.route) {
                                popUpTo(navController.graph.startDestinationId) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
                    )
                }
            }
        },
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(currentLabel) },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Filled.Menu, contentDescription = "Open navigation")
                        }
                    },
                )
            },
        ) { innerPadding ->
            NavHost(
                navController = navController,
                startDestination = Destination.Home.route,
                modifier = Modifier.padding(innerPadding),
            ) {
                composable(Destination.Home.route) { HomeScreen(repo) }
                composable(Destination.Radar.route) { RadarScreen(repo) }
                composable(Destination.Approvals.route) { ApprovalsScreen(repo) }
                composable(Destination.Campaigns.route) { CampaignsScreen() }
                composable(Destination.Analytics.route) { AnalyticsScreen() }
                composable(Destination.ContentLibrary.route) { ContentLibraryScreen() }
                composable(Destination.Research.route) { ResearchScreen() }
                composable(Destination.Creators.route) { CreatorsScreen() }
                composable(Destination.Strategy.route) { StrategyScreen() }
                composable(Destination.System.route) { SystemScreen(repo) }
                composable(Destination.Settings.route) { SettingsScreen(repo) }
            }
        }
    }
}
