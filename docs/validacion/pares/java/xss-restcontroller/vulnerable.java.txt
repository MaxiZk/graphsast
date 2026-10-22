import org.springframework.web.bind.annotation.*;

@RestController
public class BusquedaController {
    @GetMapping("/buscar")
    public String buscar(@RequestParam String q) {
        return "<p>Resultados para <b>" + q + "</b></p>";
    }
}
