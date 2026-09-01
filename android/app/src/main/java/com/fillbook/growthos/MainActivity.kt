package com.fillbook.growthos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.fillbook.growthos.data.FakeGrowthOsRepository
import com.fillbook.growthos.ui.screens.ApprovalsScreen
import com.fillbook.growthos.ui.screens.HomeScreen
import com.fillbook.growthos.ui.screens.RadarScreen
import com.fillbook.growthos.ui.theme.FillbookGrowthOSTheme

private sealed class Destination(val route: String, val label: String) {
    data object Home : Destination("home", "Home")
    data object Radar : Destination("radar", "Radar")
    data object Approvals : Destination("approvals", "Approvals")
}

private val destinations = listOf(Destination.Home, Destination.Radar, Destination.Approvals)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val repo = FakeGrowthOsRepository()
        setContent {
            FillbookGrowthOSTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    GrowthOsApp(repo)
                }
            }
        }
    }
}

@Composable
private fun GrowthOsApp(repo: com.fillbook.growthos.data.GrowthOsRepository) {
    val navController = rememberNavController()

    Scaffold(
        bottomBar = {
            NavigationBar {
                val backStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = backStackEntry?.destination

                destinations.forEach { destination ->
                    val selected = currentDestination?.hierarchy?.any { it.route == destination.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(destination.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = {
                            Icon(
                                imageVector = when (destination) {
                                    Destination.Home -> Icons.Filled.Home
                                    Destination.Radar -> Icons.Filled.Radar
                                    Destination.Approvals -> Icons.Filled.CheckCircle
                                },
                                contentDescription = destination.label,
                            )
                        },
                        label = { Text(destination.label) },
                    )
                }
            }
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
        }
    }
}
